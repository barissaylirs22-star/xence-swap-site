/**
 * Solana mainnet-beta read endpoints for the browser.
 * Official public RPC often returns 403 for browser Origin requests.
 * Prefer keyless public endpoints; override with VITE_SOLANA_RPC_URL when needed.
 * Never put secret API keys in frontend code — use a proxy if keyed access is required.
 */

export const SOLANA_NETWORK = "mainnet-beta" as const;

/** Keyless mainnet endpoints that accept browser Origins. */
export const MAINNET_RPC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.publicnode.com",
] as const;

/** Official cluster URL — kept last; frequently blocks browser Origins. */
export const OFFICIAL_MAINNET_RPC =
  "https://api.mainnet-beta.solana.com" as const;

/**
 * Note: several public providers allow getTokenSupply / getParsedAccountInfo but
 * block or rate-limit getTokenLargestAccounts.
 *
 * Holder concentration uses the same-origin `/api/solana-holders` proxy with
 * server-only `HELIUS_API_KEY` (see vite/holdersRpcProxy.ts and workers/holders-rpc.js).
 */
export function getSolanaRpcEndpoints(): string[] {
  const preferred = (import.meta.env.VITE_SOLANA_RPC_URL ?? "").trim();
  const ordered = [
    ...(preferred ? [preferred] : []),
    ...MAINNET_RPC_FALLBACKS,
    OFFICIAL_MAINNET_RPC,
  ];
  return [...new Set(ordered)];
}

/** Primary endpoint used when a single URL is required. */
export function getPrimarySolanaRpcUrl(): string {
  return getSolanaRpcEndpoints()[0] ?? OFFICIAL_MAINNET_RPC;
}
