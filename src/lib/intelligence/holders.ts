import { ONCHAIN_REFETCH_MS } from "@/config/providers";
import { getCached, setCached } from "@/lib/market/cache";
import { getSolanaRpcEndpoints } from "@/lib/solana/rpcEndpoints";
import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import type { HolderConcentrationSnapshot, HolderFetchStatus } from "./types";

/** Same-origin Vite / Cloudflare proxy — keeps API keys off the client. */
export const HOLDERS_RPC_PROXY_PATH = "/api/solana-holders";

const PER_ENDPOINT_TIMEOUT_MS = 12_000;
/** DAS census can require many pages for larger tokens. */
const HOLDER_CENSUS_TIMEOUT_MS = 75_000;
const HOLDER_CENSUS_PAGE_SIZE = 1_000;
/** Stop before inventing a partial count for mega-tokens. */
const HOLDER_CENSUS_MAX_PAGES = 80;
const HOLDERS_OK_TTL_MS = ONCHAIN_REFETCH_MS;
const HOLDERS_FAIL_TTL_MS = 12_000;

function holdersCacheKey(mint: string, lite = false): string {
  return lite ? `holders:v4:lite:${mint}` : `holders:v4:${mint}`;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; message?: string };
  return (
    err.name === "AbortError" ||
    `${err.message ?? ""}`.toLowerCase().includes("aborted")
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Holder analysis failed";
  }
}

function holdersDebug(enabled: boolean, ...args: unknown[]): void {
  if (!enabled) return;
  console.info("[holders]", ...args);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Largest / Top-10 % of reported supply using raw amounts only:
 *   pct = (accountRaw / supplyRaw) * 100
 */
function pctOfSupply(partRaw: bigint, supplyRaw: bigint): number {
  if (supplyRaw <= 0n || partRaw <= 0n) return 0;
  return Number((partRaw * 10_000n) / supplyRaw) / 100;
}

function unavailable(
  status: HolderFetchStatus,
  errorMessage?: string,
): HolderConcentrationSnapshot {
  return {
    status,
    holderCount: null,
    topHolderPct: null,
    top10HolderPct: null,
    accountsSampled: 0,
    updatedAt: Date.now(),
    errorMessage,
  };
}

/**
 * Preferred order:
 * 1) same-origin holders proxy (HELIUS_API_KEY server-side)
 * 2) optional VITE_SOLANA_HOLDERS_RPC_URL (legacy / emergency only)
 * 3) general Solana RPC fallbacks (often block getTokenLargestAccounts)
 */
function holdersRpcEndpoints(): string[] {
  const proxy =
    (import.meta.env.VITE_HOLDERS_RPC_PROXY_PATH ?? "").trim() ||
    HOLDERS_RPC_PROXY_PATH;
  const legacyClientUrl = (
    import.meta.env.VITE_SOLANA_HOLDERS_RPC_URL ?? ""
  ).trim();
  const ordered = [
    proxy,
    ...(legacyClientUrl ? [legacyClientUrl] : []),
    ...getSolanaRpcEndpoints(),
  ];
  return [...new Set(ordered)];
}

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: JsonRpcError;
}

interface TokenAmountRow {
  address?: string;
  amount: string;
  decimals?: number;
  uiAmount?: number | null;
  uiAmountString?: string;
}

interface LargestFetchOk {
  endpoint: string;
  supplyRaw: bigint;
  supplyUi: number | null;
  decimals: number | null;
  amounts: bigint[];
  topUiAmount: number | null;
  holderCount: number | null;
}

async function postJsonRpc<T>(
  endpoint: string,
  method: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "holders",
      method,
      params,
    }),
    signal,
  });

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (!response.ok && !payload.error) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }
  if (payload.error) {
    throw new Error(
      payload.error.message ??
        `JSON-RPC error ${payload.error.code ?? "unknown"}`,
    );
  }
  if (payload.result === undefined) {
    throw new Error(`Empty JSON-RPC result from ${method}`);
  }
  return payload.result;
}

interface DasTokenAccountRow {
  address?: string;
  mint?: string;
  owner?: string;
  amount?: number | string;
}

interface DasTokenAccountsResult {
  total?: number;
  limit?: number;
  page?: number;
  token_accounts?: DasTokenAccountRow[];
}

/**
 * Exact unique holder census via Helius DAS getTokenAccounts.
 * Counts unique owners with amount > 0. Returns null if pagination cannot complete
 * within the page budget (never returns a partial estimate).
 */
async function fetchHolderCensus(
  endpoint: string,
  mint: string,
  signal?: AbortSignal,
  debug = false,
): Promise<number | null> {
  const owners = new Set<string>();
  let page = 1;

  while (page <= HOLDER_CENSUS_MAX_PAGES) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const result = await postJsonRpc<DasTokenAccountsResult>(
      endpoint,
      "getTokenAccounts",
      {
        mint,
        page,
        limit: HOLDER_CENSUS_PAGE_SIZE,
        options: { showZeroBalance: false },
      },
      signal,
    );

    const rows = result.token_accounts ?? [];
    if (rows.length === 0) {
      holdersDebug(debug, "census-complete", {
        mint,
        pages: page,
        uniqueHolders: owners.size,
      });
      return owners.size;
    }

    for (const row of rows) {
      let raw = 0n;
      try {
        raw = BigInt(String(row.amount ?? 0));
      } catch {
        continue;
      }
      if (raw <= 0n) continue;
      const owner = typeof row.owner === "string" ? row.owner.trim() : "";
      if (owner) owners.add(owner);
    }

    if (rows.length < HOLDER_CENSUS_PAGE_SIZE) {
      holdersDebug(debug, "census-complete", {
        mint,
        pages: page,
        uniqueHolders: owners.size,
      });
      return owners.size;
    }

    page += 1;
  }

  holdersDebug(debug, "census-incomplete", {
    mint,
    pages: HOLDER_CENSUS_MAX_PAGES,
    uniqueHoldersSoFar: owners.size,
  });
  return null;
}

/**
 * Exact JSON-RPC shape Helius documents for largest accounts:
 *   params: [mintAddress]
 * Holder count uses DAS getTokenAccounts census on the same endpoint.
 * Concentration failure does not skip census when possible.
 */
async function fetchFromEndpoint(
  endpoint: string,
  mint: string,
  signal?: AbortSignal,
  debug = false,
  includeCensus = true,
): Promise<LargestFetchOk> {
  const supplyRes = await postJsonRpc<{
    value: {
      amount: string;
      decimals: number;
      uiAmount: number | null;
    };
  }>(endpoint, "getTokenSupply", [mint], signal);

  const supplyAmount = supplyRes.value?.amount;
  if (!supplyAmount) {
    throw new Error("Token supply unavailable");
  }
  const supplyRaw = BigInt(supplyAmount);
  if (supplyRaw <= 0n) {
    throw new Error("Token supply is zero");
  }

  const amounts: bigint[] = [];
  let topUiAmount: number | null = null;
  let concentrationError: string | null = null;

  try {
    const largestRes = await withTimeout(
      postJsonRpc<{ value: TokenAmountRow[] }>(
        endpoint,
        "getTokenLargestAccounts",
        [mint],
        signal,
      ),
      PER_ENDPOINT_TIMEOUT_MS,
      signal,
    );
    for (const row of largestRes.value ?? []) {
      const raw = BigInt(row.amount);
      if (raw <= 0n) continue;
      amounts.push(raw);
      if (topUiAmount === null && typeof row.uiAmount === "number") {
        topUiAmount = row.uiAmount;
      }
    }
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error instanceof Error
        ? error
        : new DOMException("Aborted", "AbortError");
    }
    concentrationError = classifyHolderError(errorText(error));
    holdersDebug(debug, "concentration-fail", {
      mint,
      endpoint: redactEndpoint(endpoint),
      error: concentrationError,
    });
  }

  let holderCount: number | null = null;
  if (includeCensus) {
    try {
      holderCount = await withTimeout(
        fetchHolderCensus(endpoint, mint, signal, debug),
        HOLDER_CENSUS_TIMEOUT_MS,
        signal,
      );
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw error instanceof Error
          ? error
          : new DOMException("Aborted", "AbortError");
      }
      holdersDebug(debug, "census-fail", {
        mint,
        endpoint: redactEndpoint(endpoint),
        error: errorText(error),
      });
      holderCount = null;
    }
  }

  if (amounts.length === 0 && holderCount == null) {
    throw new Error(
      concentrationError ??
        "Holder concentration and census both unavailable on this endpoint",
    );
  }

  return {
    endpoint,
    supplyRaw,
    supplyUi:
      typeof supplyRes.value.uiAmount === "number"
        ? supplyRes.value.uiAmount
        : null,
    decimals: supplyRes.value.decimals ?? null,
    amounts,
    topUiAmount,
    holderCount,
  };
}

function classifyHolderError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("too many accounts requested")) {
    return "Token account set too large for getTokenLargestAccounts on this provider";
  }
  if (lower.includes("request blocked") || lower.includes("access forbidden")) {
    return "RPC blocked getTokenLargestAccounts";
  }
  if (lower.includes("401") || lower.includes("unauthorized")) {
    return "Holder RPC unauthorized — check HELIUS_API_KEY";
  }
  if (lower.includes("not configured")) {
    return message;
  }
  return message;
}

async function fetchLargestAndSupply(
  mint: string,
  signal?: AbortSignal,
  debug = false,
  includeCensus = true,
): Promise<LargestFetchOk> {
  const endpoints = holdersRpcEndpoints();
  const failures: string[] = [];

  holdersDebug(debug, "endpoints", endpoints.map(redactEndpoint));

  for (const endpoint of endpoints) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const budget = includeCensus
        ? PER_ENDPOINT_TIMEOUT_MS + HOLDER_CENSUS_TIMEOUT_MS
        : PER_ENDPOINT_TIMEOUT_MS;
      const result = await withTimeout(
        fetchFromEndpoint(endpoint, mint, signal, debug, includeCensus),
        budget,
        signal,
      );
      holdersDebug(debug, "rpc-ok", {
        endpoint: redactEndpoint(endpoint),
        supplyRaw: result.supplyRaw.toString(),
        supplyUi: result.supplyUi,
        accounts: result.amounts.length,
        topRaw: result.amounts[0]?.toString() ?? null,
        topUi: result.topUiAmount,
        holderCount: result.holderCount,
        includeCensus,
      });
      return result;
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw error instanceof Error
          ? error
          : new DOMException("Aborted", "AbortError");
      }
      const msg = classifyHolderError(errorText(error));
      failures.push(`${redactEndpoint(endpoint)} → ${msg}`);
      holdersDebug(debug, "rpc-fail", {
        endpoint: redactEndpoint(endpoint),
        error: msg,
      });
    }
  }

  throw new Error(
    failures.length
      ? `getTokenLargestAccounts failed on all RPCs: ${failures.join(" | ")}`
      : "No Solana RPC endpoints configured for holder analysis",
  );
}

function redactEndpoint(endpoint: string): string {
  try {
    if (endpoint.startsWith("/")) return endpoint;
    const u = new URL(endpoint);
    if (u.searchParams.has("api-key")) {
      u.searchParams.set("api-key", "***");
    }
    return u.toString();
  } catch {
    return endpoint.includes("api-key") ? "[redacted-rpc]" : endpoint;
  }
}

/**
 * Holder concentration (getTokenLargestAccounts) + optional exact holder census
 * (Helius DAS getTokenAccounts unique non-zero owners).
 * Discovery list enrichment should pass `{ includeCensus: false }` to avoid
 * flooding Helius with full holder-count pagination.
 */
export async function fetchHolderConcentration(
  mint: string,
  _supplyRawHint?: bigint | null,
  signal?: AbortSignal,
  options?: { includeCensus?: boolean },
): Promise<HolderConcentrationSnapshot> {
  const trimmed = mint.trim();
  const debug = Boolean(import.meta.env.DEV);
  const includeCensus = options?.includeCensus !== false;
  const lite = !includeCensus;

  if (!looksLikeMintAddress(trimmed)) {
    return unavailable("unavailable", "Invalid mint");
  }

  const cached = getCached<HolderConcentrationSnapshot>(
    holdersCacheKey(trimmed, lite),
  );
  if (cached) {
    holdersDebug(debug, "cache-hit", {
      mint: trimmed,
      status: cached.status,
      holderCount: cached.holderCount,
      topHolderPct: cached.topHolderPct,
      errorMessage: cached.errorMessage,
      lite,
    });
    return cached;
  }

  if (lite) {
    const full = getCached<HolderConcentrationSnapshot>(
      holdersCacheKey(trimmed, false),
    );
    if (full) return full;
  }

  holdersDebug(debug, "start", { mint: trimmed, includeCensus });

  try {
    const fetched = await fetchLargestAndSupply(
      trimmed,
      signal,
      debug,
      includeCensus,
    );

    if (fetched.amounts.length === 0) {
      const empty: HolderConcentrationSnapshot = {
        status: "unavailable",
        holderCount: fetched.holderCount,
        topHolderPct: null,
        top10HolderPct: null,
        accountsSampled: 0,
        updatedAt: Date.now(),
        errorMessage:
          fetched.holderCount != null
            ? "Largest-account concentration unavailable"
            : `No non-zero token accounts from ${redactEndpoint(fetched.endpoint)}`,
      };
      setCached(holdersCacheKey(trimmed, lite), empty, HOLDERS_FAIL_TTL_MS);
      return empty;
    }

    const sorted = [...fetched.amounts].sort((a, b) =>
      a === b ? 0 : a > b ? -1 : 1,
    );
    const top = sorted[0]!;
    const top10 = sorted.slice(0, 10).reduce((acc, n) => acc + n, 0n);
    const topHolderPct = pctOfSupply(top, fetched.supplyRaw);
    const top10HolderPct = pctOfSupply(top10, fetched.supplyRaw);

    const snap: HolderConcentrationSnapshot = {
      status: "ok",
      holderCount: fetched.holderCount,
      topHolderPct,
      top10HolderPct,
      accountsSampled: sorted.length,
      updatedAt: Date.now(),
    };

    holdersDebug(debug, "computed", {
      mint: trimmed,
      endpoint: redactEndpoint(fetched.endpoint),
      supplyRaw: fetched.supplyRaw.toString(),
      topRaw: top.toString(),
      topUi: fetched.topUiAmount,
      topHolderPct,
      top10HolderPct,
      holderCount: fetched.holderCount,
      includeCensus,
    });

    setCached(holdersCacheKey(trimmed, lite), snap, HOLDERS_OK_TTL_MS);
    if (!lite) {
      setCached(holdersCacheKey(trimmed, true), snap, HOLDERS_OK_TTL_MS);
    }
    return snap;
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error instanceof Error
        ? error
        : new DOMException("Aborted", "AbortError");
    }

    const failed = unavailable(
      "error",
      classifyHolderError(errorText(error)),
    );
    holdersDebug(debug, "error", { mint: trimmed, error: failed.errorMessage });
    setCached(holdersCacheKey(trimmed, lite), failed, HOLDERS_FAIL_TTL_MS);
    return failed;
  }
}
