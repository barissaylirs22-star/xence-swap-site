export type TokenWarning =
  | "unverified"
  | "unknown_metadata"
  | "coming_soon"
  | "no_route"
  | "low_liquidity";

export interface TokenAsset {
  mint: string;
  symbol: string;
  name: string;
  decimals: number | null;
  iconUrl?: string | null;
  isNativeSol?: boolean;
  /** Trusted/verified when the discovery source reports it reliably. */
  verified?: boolean;
  warnings?: TokenWarning[];
  /** False for placeholders like pre-launch AXM. */
  selectable: boolean;
  balanceUi?: number | null;
  /** Informational market fields — never used for swap execution. */
  priceUsd?: number | null;
  priceChange5mPct?: number | null;
  priceChange1hPct?: number | null;
  priceChange24hPct?: number | null;
  volume24hUsd?: number | null;
  liquidityUsd?: number | null;
  marketCapUsd?: number | null;
  fdvUsd?: number | null;
  /** Pair created / listing time (epoch ms) when the market source provides it. */
  listedAt?: number | null;
  /** Fresh listing signal for discovery UI only. */
  isFresh?: boolean;
  /** Optional off-chain metadata URI (e.g. Pump.fun) — never used for execution. */
  metadataUri?: string | null;
}

export interface TokenSearchResult {
  tokens: TokenAsset[];
  query: string;
}

export interface TokenDiscoveryProvider {
  readonly id: string;
  search(query: string, signal?: AbortSignal): Promise<TokenAsset[]>;
  getByMint(mint: string, signal?: AbortSignal): Promise<TokenAsset | null>;
}

export interface TokenMetadataProvider {
  readonly id: string;
  getMetadata(mint: string, signal?: AbortSignal): Promise<TokenAsset | null>;
}

export interface TokenBrowseSection {
  id: "popular" | "trending" | "new";
  title: string;
  tokens: TokenAsset[];
  unavailable?: boolean;
}
