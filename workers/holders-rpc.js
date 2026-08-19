/**
 * Cloudflare Worker — production same-origin APIs on axiom-swap.xyz:
 *   POST /api/solana-holders  — Helius JSON-RPC proxy (secret stays server-side)
 *   GET|POST /api/solana-rpc — standard Solana JSON-RPC + optional Provider B failover
 *   GET|POST /api/holder-intel — persistent holder history (KV)
 *
 * Bindings (see wrangler.toml):
 *   HELIUS_API_KEY or SOLANA_HOLDERS_RPC_URL  (secrets / vars)
 *   SOLANA_RPC_FALLBACK_URL (optional Provider B, e.g. Alchemy — never VITE_*)
 *   AXIOM_HOLDER_INTEL  (KV namespace — production holder history)
 *
 * Without AXIOM_HOLDER_INTEL KV, /api/holder-intel returns 503 (holders RPC still works).
 * Local Vite continues to use middleware + .data file store — this file is production only.
 */

import {
  applyObservation,
  buildIntelFromSeries,
  isUsableObservation,
  isValidMint,
  normalizeObservation,
  pruneMintSeries,
  MAX_MINTS,
} from "../server/holderIntel/core.mjs";
import { createHolderIntelHandler } from "../server/holderIntel/api.mjs";
import {
  STANDARD_RPC_ALLOWED_METHODS,
  forwardStandardRpcWithFailover,
  resolveStandardRpcFallback,
  resolveStandardRpcPrimary,
  safeRpcErrorMessage,
} from "../server/solanaRpcFailover.mjs";

const MAX_BODY_BYTES = 1_048_576; // 1 MiB — whale/history RPC batches
const RPC_RATE_WINDOW_MS = 60_000;
const RPC_RATE_MAX = 120;

/** @type {Map<string, number[]>} */
const rpcHits = new Map();

function upstreamFromEnv(env) {
  const explicit = (env.SOLANA_HOLDERS_RPC_URL ?? "").trim();
  if (explicit) return explicit;
  const key = (env.HELIUS_API_KEY ?? "").replace(/\r/g, "").trim();
  if (key) {
    return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
  }
  return null;
}

/**
 * Never return upstream URLs or api-key material to clients / logs.
 * @param {unknown} error
 */
function safeErrorMessage(error) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "upstream failed";
  return raw
    .replace(/https?:\/\/[^\s)'"]+/gi, "[redacted-url]")
    .replace(/api-key=[^&\s)'"]+/gi, "api-key=***")
    .slice(0, 180);
}

const ALLOWED_RPC_METHODS = new Set([
  "getTokenSupply",
  "getTokenLargestAccounts",
  "getTokenAccounts",
  "getSignaturesForAddress",
  "getTransaction",
  "getAccountInfo",
  "getMultipleAccounts",
]);

function normalizePath(pathname) {
  if (!pathname) return "/";
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function clientIdFromRequest(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anon"
  );
}

function rpcRateLimitOk(clientId) {
  const now = Date.now();
  const bucket = rpcHits.get(clientId) ?? [];
  const recent = bucket.filter((t) => now - t < RPC_RATE_WINDOW_MS);
  if (recent.length >= RPC_RATE_MAX) {
    rpcHits.set(clientId, recent);
    return false;
  }
  recent.push(now);
  rpcHits.set(clientId, recent);
  return true;
}

function kvKey(mint) {
  return `hi:v1:${mint}`;
}

function createKvStore(kv) {
  return {
    async getSeries(mint) {
      const raw = await kv.get(kvKey(mint), "json");
      if (!raw || !Array.isArray(raw.snapshots)) return [];
      return pruneMintSeries(raw.snapshots, Date.now());
    },

    async updateSeries(mint, mutator) {
      const now = Date.now();
      const existing = await this.getSeries(mint);
      const result = mutator(existing, now);
      const series = pruneMintSeries(result.series, now);

      // Lightweight mint index for LRU-ish eviction of cold mints.
      const indexRaw = (await kv.get("hi:v1:__index", "json")) || { mints: {} };
      const index =
        indexRaw.mints && typeof indexRaw.mints === "object"
          ? indexRaw.mints
          : {};
      index[mint] = now;

      const entries = Object.entries(index).sort((a, b) => b[1] - a[1]);
      const keep = new Set(entries.slice(0, MAX_MINTS).map(([m]) => m));
      const nextIndex = {};
      for (const [m, t] of entries) {
        if (keep.has(m)) nextIndex[m] = t;
        else if (m !== mint) {
          await kv.delete(kvKey(m));
        }
      }
      nextIndex[mint] = now;

      await kv.put(
        kvKey(mint),
        JSON.stringify({ v: 1, snapshots: series }),
      );
      await kv.put("hi:v1:__index", JSON.stringify({ v: 1, mints: nextIndex }));

      return {
        series,
        meta: result.meta ?? {},
      };
    },
  };
}

async function readBodyLimited(request) {
  const lenHeader = request.headers.get("content-length");
  if (lenHeader) {
    const n = Number(lenHeader);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      const err = new Error("Request body too large");
      err.status = 413;
      throw err;
    }
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) {
    const err = new Error("Request body too large");
    err.status = 413;
    throw err;
  }
  return new TextDecoder().decode(buf);
}

async function handleHoldersRpc(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const clientId = clientIdFromRequest(request);
  if (!rpcRateLimitOk(clientId)) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32029, message: "Too many requests" },
      },
      { status: 429 },
    );
  }

  const upstream = upstreamFromEnv(env);
  if (!upstream) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32001,
          message: "HELIUS_API_KEY or SOLANA_HOLDERS_RPC_URL not configured",
        },
      },
      { status: 503 },
    );
  }

  try {
    const body = await readBodyLimited(request);
    let method = "unknown";
    let mintHint = null;
    try {
      const parsed = JSON.parse(body || "{}");
      method = parsed.method || "unknown";
      if (Array.isArray(parsed.params) && typeof parsed.params[0] === "string") {
        mintHint = `${parsed.params[0].slice(0, 6)}…`;
      } else if (parsed.params && typeof parsed.params.mint === "string") {
        mintHint = `${parsed.params.mint.slice(0, 6)}…`;
      }
    } catch {
      // ignore parse diagnostics
    }

    if (!ALLOWED_RPC_METHODS.has(method)) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32601,
            message: `Method not allowed on holders proxy: ${method}`,
          },
        },
        { status: 403 },
      );
    }

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body || "{}",
    });
    const text = await upstreamRes.text();

    let rpcError = null;
    try {
      const parsed = JSON.parse(text);
      rpcError = parsed.error?.message || null;
    } catch {
      rpcError = upstreamRes.ok ? null : text.slice(0, 120);
    }

    if (!upstreamRes.ok || rpcError) {
      console.warn("[holders-proxy]", {
        method,
        mintHint,
        http: upstreamRes.status,
        rpcError: rpcError ? safeErrorMessage(rpcError) : null,
      });
    }

    return new Response(text, {
      status: upstreamRes.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error && error.status === 413 ? 413 : 502;
    console.warn("[holders-proxy]", { error: safeErrorMessage(error) });
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: status === 413 ? -32003 : -32002,
          message:
            status === 413
              ? "Request body too large"
              : "Holder RPC upstream failed",
        },
      },
      { status },
    );
  }
}

async function handleStandardSolanaRpc(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const primaryUrl = resolveStandardRpcPrimary(env);
  const fallbackUrl = resolveStandardRpcFallback(env);

  if (request.method === "GET") {
    return Response.json(
      {
        ok: true,
        fallbackConfigured: Boolean(fallbackUrl),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const clientId = clientIdFromRequest(request);
  if (!rpcRateLimitOk(clientId)) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32029, message: "Too many requests" },
      },
      { status: 429 },
    );
  }

  try {
    const body = await readBodyLimited(request);
    let method = "unknown";
    try {
      const parsed = JSON.parse(body || "{}");
      method = parsed.method || "unknown";
    } catch {
      // ignore
    }

    if (!STANDARD_RPC_ALLOWED_METHODS.has(method)) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32601,
            message: `Method not allowed on standard RPC proxy: ${method}`,
          },
        },
        { status: 403 },
      );
    }

    const result = await forwardStandardRpcWithFailover({
      body: body || "{}",
      primaryUrl,
      fallbackUrl,
    });

    if (result.used === "fallback") {
      console.warn("[solana-rpc-proxy]", {
        method,
        used: "fallback",
        http: result.status,
      });
    }

    return new Response(result.text, {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Axiom-Rpc-Upstream": result.used,
        "X-Axiom-Rpc-Fallback-Attempted": result.fallbackAttempted ? "1" : "0",
      },
    });
  } catch (error) {
    const status = error && error.status === 413 ? 413 : 502;
    console.warn("[solana-rpc-proxy]", { error: safeRpcErrorMessage(error) });
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: status === 413 ? -32003 : -32002,
          message:
            status === 413
              ? "Request body too large"
              : "Standard Solana RPC proxy failed",
        },
      },
      { status },
    );
  }
}

async function handleHolderIntel(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  if (!env.AXIOM_HOLDER_INTEL) {
    return Response.json(
      {
        error:
          "AXIOM_HOLDER_INTEL KV binding not configured — holder history unavailable",
      },
      { status: 503 },
    );
  }

  const store = createKvStore(env.AXIOM_HOLDER_INTEL);
  // Production: never allow observation backdating (dev-only Vite flag).
  const { handle } = createHolderIntelHandler(store, { allowBackdate: false });
  const clientId = clientIdFromRequest(request);
  const url = new URL(request.url);

  try {
    let bodyText = "";
    if (request.method === "POST") {
      bodyText = await readBodyLimited(request);
    }
    const result = await handle({
      method: request.method,
      bodyText,
      mintQuery: url.searchParams.get("mint"),
      clientId,
    });
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status = error && error.status === 413 ? 413 : 500;
    console.warn("[holder-intel]", { error: safeErrorMessage(error) });
    return Response.json(
      {
        error:
          status === 413 ? "Request body too large" : "Holder intel store failed",
      },
      { status },
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (path === "/api/solana-holders") {
      return handleHoldersRpc(request, env);
    }

    if (path === "/api/solana-rpc") {
      return handleStandardSolanaRpc(request, env);
    }

    if (path === "/api/holder-intel") {
      return handleHolderIntel(request, env);
    }

    // Health probe for ops (no secrets).
    if (path === "/api/health" || path === "/") {
      return Response.json(
        {
          ok: true,
          service: "axiom-holders-api",
          holdersRpc: Boolean(upstreamFromEnv(env)),
          standardRpcFallback: Boolean(resolveStandardRpcFallback(env)),
          holderIntelKv: Boolean(env.AXIOM_HOLDER_INTEL),
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    return new Response("Not found", { status: 404 });
  },
};

// Shared pure helpers available for local Worker readiness checks.
export {
  applyObservation,
  buildIntelFromSeries,
  isValidMint,
  normalizeObservation,
  isUsableObservation,
  safeErrorMessage,
  ALLOWED_RPC_METHODS,
};
