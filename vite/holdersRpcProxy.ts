import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

export const HOLDERS_RPC_PROXY_PATH = "/api/solana-holders";

/** JSON-RPC methods allowed through the holders/Helius proxy. */
export const HOLDERS_RPC_ALLOWED_METHODS = new Set([
  "getTokenSupply",
  "getTokenLargestAccounts",
  "getTokenAccounts",
  "getSignaturesForAddress",
  "getTransaction",
  "getAccountInfo",
  "getMultipleAccounts",
]);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function resolveUpstream(env: Record<string, string>): string | null {
  const explicit = (env.SOLANA_HOLDERS_RPC_URL ?? "").trim();
  if (explicit) return explicit;

  const key = (env.HELIUS_API_KEY ?? "").replace(/\r/g, "").trim();
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;

  return null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

/**
 * Same-origin JSON-RPC proxy for holder concentration.
 * Keeps HELIUS_API_KEY / SOLANA_HOLDERS_RPC_URL off the client bundle.
 */
export function holdersRpcProxyPlugin(env: Record<string, string>): Plugin {
  const upstream = resolveUpstream(env);

  const middleware: Middleware = async (req, res, next) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url !== HOLDERS_RPC_PROXY_PATH) {
      next();
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.end();
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (!upstream) {
      sendJson(res, 503, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32001,
          message:
            "Holder RPC proxy not configured. Set HELIUS_API_KEY or SOLANA_HOLDERS_RPC_URL in .env.local",
        },
      });
      return;
    }

    try {
      const raw = await readBody(req);
      let method = "unknown";
      let mintHint: string | null = null;
      try {
        const parsed = JSON.parse(raw || "{}") as {
          method?: string;
          params?: unknown;
        };
        method = parsed.method ?? "unknown";
        if (Array.isArray(parsed.params) && typeof parsed.params[0] === "string") {
          mintHint = `${parsed.params[0].slice(0, 6)}…`;
        } else if (
          parsed.params &&
          typeof parsed.params === "object" &&
          typeof (parsed.params as { mint?: unknown }).mint === "string"
        ) {
          const mint = (parsed.params as { mint: string }).mint;
          mintHint = `${mint.slice(0, 6)}…`;
        }
      } catch {
        // ignore parse diagnostics
      }

      if (!HOLDERS_RPC_ALLOWED_METHODS.has(method)) {
        sendJson(res, 403, {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32601,
            message: `Method not allowed on holders proxy: ${method}`,
          },
        });
        return;
      }

      const upstreamRes = await fetch(upstream, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw || "{}",
      });
      const text = await upstreamRes.text();

      let rpcError: string | null = null;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        rpcError = parsed.error?.message ?? null;
      } catch {
        rpcError = upstreamRes.ok ? null : text.slice(0, 120);
      }

      if (!upstreamRes.ok || rpcError) {
        console.warn("[holders-proxy]", {
          method,
          mintHint,
          http: upstreamRes.status,
          rpcError,
        });
      }

      res.statusCode = upstreamRes.status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(text);
    } catch (error) {
      console.warn("[holders-proxy]", {
        error: error instanceof Error ? error.message : "upstream failed",
      });
      sendJson(res, 502, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32002,
          message:
            error instanceof Error
              ? error.message
              : "Holder RPC proxy upstream failed",
        },
      });
    }
  };

  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(middleware);
  };

  return {
    name: "axiom-holders-rpc-proxy",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
