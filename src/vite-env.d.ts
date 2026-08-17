/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_RPC_URL?: string;
  /**
   * @deprecated Prefer HELIUS_API_KEY + /api/solana-holders proxy.
   * If set, this client-side URL is used as a legacy fallback only.
   */
  readonly VITE_SOLANA_HOLDERS_RPC_URL?: string;
  /** Same-origin holders JSON-RPC proxy path (default /api/solana-holders). */
  readonly VITE_HOLDERS_RPC_PROXY_PATH?: string;
  readonly VITE_MARKET_PROXY_URL?: string;
  readonly VITE_SWAP_PROXY_URL?: string;
  /** Prefer a server proxy — do not ship secret keys in the client. */
  readonly VITE_JUPITER_API_KEY?: string;
  /**
   * Optional Pump.fun realtime WebSocket URL (public or proxied).
   * Never put provider secrets here — proxy them server-side instead.
   */
  readonly VITE_PUMP_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
