export type MarketSource = "jupiter-price-v3" | "jupiter-tokens-v2" | "proxy";

export type MetricStatus = "loading" | "ready" | "unavailable" | "error";

export interface AxmMarketSnapshot {
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  sources: MarketSource[];
  updatedAt: string | null;
  error: string | null;
}

export const EMPTY_MARKET: AxmMarketSnapshot = {
  priceUsd: null,
  priceChange24h: null,
  liquidityUsd: null,
  volume24hUsd: null,
  marketCapUsd: null,
  sources: [],
  updatedAt: null,
  error: null,
};
