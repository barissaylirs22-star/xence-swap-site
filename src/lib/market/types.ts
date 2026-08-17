export interface MarketSnapshot {
  mint: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  pairLabel: string | null;
  updatedAt: string | null;
  source: string;
}

export interface MarketDataProvider {
  readonly id: string;
  /**
   * Informational only — never used to authorize or build swap transactions.
   */
  getTokenMarket(
    mint: string,
    signal?: AbortSignal,
  ): Promise<MarketSnapshot | null>;
}
