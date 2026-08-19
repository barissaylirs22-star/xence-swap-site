/**
 * Standard Solana JSON-RPC failover (server-only).
 * Primary = keyless public RPC. Secondary = SOLANA_RPC_FALLBACK_URL.
 * Never log or return upstream URLs / API keys.
 */

export const SOLANA_RPC_PROXY_PATH = "/api/solana-rpc";
export const DEFAULT_SOLANA_RPC_PRIMARY =
  "https://solana-rpc.publicnode.com";

/** Methods used by current same-origin callers — never DAS getTokenAccounts. */
export const STANDARD_RPC_ALLOWED_METHODS = new Set([
  "getTokenSupply",
  "getAccountInfo",
]);

export const PRIMARY_TIMEOUT_MS = 12_000;

/** @param {Record<string, string | undefined> | null | undefined} env */
export function resolveStandardRpcPrimary(env) {
  return (env?.SOLANA_RPC_PRIMARY_URL ?? "").trim() || DEFAULT_SOLANA_RPC_PRIMARY;
}

/** @param {Record<string, string | undefined> | null | undefined} env */
export function resolveStandardRpcFallback(env) {
  const url = (env?.SOLANA_RPC_FALLBACK_URL ?? "").trim();
  return url || null;
}

/**
 * Transport failures only — not JSON-RPC business errors on HTTP 200.
 * @param {number | null} httpStatus
 * @param {{ network?: boolean, timeout?: boolean }} [flags]
 */
export function isQualifyingFailover(httpStatus, flags = {}) {
  if (flags.timeout || flags.network) return true;
  if (httpStatus === 429) return true;
  if (httpStatus != null && httpStatus >= 500) return true;
  return false;
}

/** @param {unknown} error */
export function safeRpcErrorMessage(error) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "upstream failed";
  return raw
    .replace(/https?:\/\/[^\s)'"]+/gi, "[redacted-url]")
    .replace(/api[_-]?key=[^&\s)'"]+/gi, "api-key=***")
    .slice(0, 180);
}

/**
 * POST to primary; on qualifying failure only, try fallback once (no race / no loops).
 * @param {{
 *   body: string,
 *   primaryUrl: string,
 *   fallbackUrl: string | null,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export async function forwardStandardRpcWithFailover(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? PRIMARY_TIMEOUT_MS;
  const body = opts.body || "{}";

  /** @type {{ status: number, text: string } | null} */
  let primaryResult = null;
  let primaryNetwork = false;
  let primaryTimeout = false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(opts.primaryUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      primaryResult = { status: res.status, text: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error ?? "");
    if (
      (error && typeof error === "object" && error.name === "AbortError") ||
      /aborted|timeout/i.test(msg)
    ) {
      primaryTimeout = true;
    } else {
      primaryNetwork = true;
    }
  }

  if (primaryResult && !isQualifyingFailover(primaryResult.status)) {
    return {
      status: primaryResult.status,
      text: primaryResult.text,
      used: "primary",
      fallbackAttempted: false,
    };
  }

  const qualify = isQualifyingFailover(primaryResult?.status ?? null, {
    network: primaryNetwork,
    timeout: primaryTimeout,
  });

  if (!qualify || !opts.fallbackUrl) {
    if (primaryResult) {
      return {
        status: primaryResult.status,
        text: primaryResult.text,
        used: "primary",
        fallbackAttempted: false,
      };
    }
    return {
      status: 502,
      text: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32002,
          message: primaryTimeout
            ? "Primary Solana RPC timed out"
            : "Primary Solana RPC unavailable",
        },
      }),
      used: "primary",
      fallbackAttempted: false,
    };
  }

  try {
    const res = await fetchImpl(opts.fallbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return {
      status: res.status,
      text: await res.text(),
      used: "fallback",
      fallbackAttempted: true,
    };
  } catch (error) {
    if (primaryResult) {
      return {
        status: primaryResult.status,
        text: primaryResult.text,
        used: "primary",
        fallbackAttempted: true,
      };
    }
    return {
      status: 502,
      text: JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32002, message: safeRpcErrorMessage(error) },
      }),
      used: "fallback",
      fallbackAttempted: true,
    };
  }
}
