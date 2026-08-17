import type { MarketDataProvider, MarketSnapshot } from "./types";

/**
 * Placeholder market-data provider.
 * Swap execution must never depend on this layer.
 * Future: DexScreener / proxy adapters can implement MarketDataProvider.
 */
class NullMarketDataProvider implements MarketDataProvider {
  readonly id = "null-market";

  async getTokenMarket(): Promise<MarketSnapshot | null> {
    return null;
  }
}

let provider: MarketDataProvider = new NullMarketDataProvider();

export function getMarketDataProvider(): MarketDataProvider {
  return provider;
}

/** Test / future wiring hook — does not affect swap execution. */
export function setMarketDataProvider(next: MarketDataProvider): void {
  provider = next;
}
