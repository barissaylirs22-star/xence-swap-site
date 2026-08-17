import { fetchDexMarketByMints } from "@/lib/market/dexscreener";
import type { TokenAsset } from "@/lib/tokens/types";
import type { TokenMarketFacts } from "./types";

/**
 * Market facts from DexScreener (reuses shared mint metrics cache).
 * Never invents values — unavailable fields stay null.
 */
export async function loadMarketFacts(
  token: TokenAsset,
  signal?: AbortSignal,
): Promise<TokenMarketFacts> {
  const fromAsset: TokenMarketFacts = {
    priceUsd: token.priceUsd ?? null,
    marketCapUsd: token.marketCapUsd ?? null,
    fdvUsd: token.fdvUsd ?? null,
    liquidityUsd: token.liquidityUsd ?? null,
    priceChange5mPct: token.priceChange5mPct ?? null,
    priceChange1hPct: token.priceChange1hPct ?? null,
    priceChange24hPct: token.priceChange24hPct ?? null,
    volume24hUsd: token.volume24hUsd ?? null,
    listedAt: token.listedAt ?? null,
    ageMs:
      typeof token.listedAt === "number" && Number.isFinite(token.listedAt)
        ? Math.max(0, Date.now() - token.listedAt)
        : null,
    available: false,
  };

  fromAsset.available = hasAnyMarket(fromAsset);
  if (fromAsset.available && fromAsset.priceUsd != null) {
    return fromAsset;
  }

  try {
    const map = await fetchDexMarketByMints([token.mint], signal);
    const metrics = map.get(token.mint);
    if (!metrics) return fromAsset;

    const listedAt = metrics.listedAt ?? fromAsset.listedAt;
    const merged: TokenMarketFacts = {
      priceUsd: metrics.priceUsd ?? fromAsset.priceUsd,
      marketCapUsd: metrics.marketCapUsd ?? fromAsset.marketCapUsd,
      fdvUsd: metrics.fdvUsd ?? fromAsset.fdvUsd,
      liquidityUsd: metrics.liquidityUsd ?? fromAsset.liquidityUsd,
      priceChange5mPct: metrics.priceChange5mPct ?? fromAsset.priceChange5mPct,
      priceChange1hPct: metrics.priceChange1hPct ?? fromAsset.priceChange1hPct,
      priceChange24hPct:
        metrics.priceChange24hPct ?? fromAsset.priceChange24hPct,
      volume24hUsd: metrics.volume24hUsd ?? fromAsset.volume24hUsd,
      listedAt,
      ageMs:
        typeof listedAt === "number" && Number.isFinite(listedAt)
          ? Math.max(0, Date.now() - listedAt)
          : null,
      available: false,
    };
    merged.available = hasAnyMarket(merged);
    return merged;
  } catch {
    return fromAsset;
  }
}

function hasAnyMarket(m: TokenMarketFacts): boolean {
  return (
    m.priceUsd != null ||
    m.liquidityUsd != null ||
    m.volume24hUsd != null ||
    m.marketCapUsd != null ||
    m.fdvUsd != null ||
    m.priceChange24hPct != null
  );
}
