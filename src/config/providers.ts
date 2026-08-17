/**
 * Provider endpoints for swap / token discovery / market / on-chain services.
 *
 * Routing & discovery use official Jupiter HTTP APIs behind Axiom service layers.
 * Do not put secret API keys in the client — use a proxy when keyed access is required.
 * General swap availability is controlled by `config/swap.ts`, not AXM launch status.
 */

export const JUPITER_API_BASE = "https://api.jup.ag" as const;
/** Public lite endpoint for quote/swap when no keyed proxy is configured. */
export const JUPITER_LITE_API_BASE = "https://lite-api.jup.ag" as const;

export const JUPITER_PRICE_PATH = "/price/v3" as const;
export const JUPITER_TOKENS_SEARCH_PATH = "/tokens/v2/search" as const;
export const JUPITER_QUOTE_PATH = "/swap/v1/quote" as const;
export const JUPITER_SWAP_PATH = "/swap/v1/swap" as const;

/** Optional proxy base that forwards swap quote/tx requests server-side. */
export const SWAP_PROXY_URL = import.meta.env.VITE_SWAP_PROXY_URL ?? "";

/**
 * Optional public client header for Jupiter Pro.
 * Prefer VITE_SWAP_PROXY_URL so secrets never ship in the browser bundle.
 */
export const JUPITER_CLIENT_API_KEY =
  import.meta.env.VITE_JUPITER_API_KEY ?? "";

/**
 * Primary Solana mainnet-beta RPC.
 * Official `api.mainnet-beta.solana.com` often 403s browser Origins.
 * Balance reads also use fallbacks in `lib/solana/connection.ts`.
 */
export const DEFAULT_SOLANA_RPC =
  (import.meta.env.VITE_SOLANA_RPC_URL ?? "").trim() ||
  "https://solana-rpc.publicnode.com";

export const MARKET_PROXY_URL =
  import.meta.env.VITE_MARKET_PROXY_URL ?? "";

export const MARKET_STALE_MS = 30_000;
export const MARKET_REFETCH_MS = 60_000;
export const ONCHAIN_STALE_MS = 120_000;
export const ONCHAIN_REFETCH_MS = 180_000;

/** Quote freshness window — requote before building a swap tx. */
export const QUOTE_STALE_MS = 20_000;
export const QUOTE_REFETCH_MS = 15_000;

export const DEFAULT_SLIPPAGE_BPS = 50;
export const MAX_SLIPPAGE_BPS = 1_000;
export const MIN_SLIPPAGE_BPS = 1;
