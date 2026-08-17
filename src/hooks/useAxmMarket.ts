import { useQuery } from "@tanstack/react-query";
import { isLaunchLive } from "@/config/launch";
import { MARKET_REFETCH_MS, MARKET_STALE_MS } from "@/config/providers";
import { fetchLiveTokenPrice } from "@/lib/jupiter/price";
import { fetchLiveTokenStats } from "@/lib/jupiter/tokens";
import type { AxmMarketSnapshot } from "@/types/market";
import { EMPTY_MARKET } from "@/types/market";

async function loadMarket(signal: AbortSignal): Promise<AxmMarketSnapshot> {
  if (!isLaunchLive()) return { ...EMPTY_MARKET };

  const price = await fetchLiveTokenPrice(signal);
  try {
    const extra = await fetchLiveTokenStats(signal);
    if (!extra) return price;
    return {
      ...price,
      volume24hUsd: extra.volume24hUsd ?? price.volume24hUsd,
      marketCapUsd: extra.marketCapUsd ?? price.marketCapUsd,
      liquidityUsd: extra.liquidityUsd ?? price.liquidityUsd,
      priceChange24h: extra.priceChange24h ?? price.priceChange24h,
      sources: Array.from(
        new Set([...price.sources, ...(extra.sources ?? ["proxy"])]),
      ),
      updatedAt: extra.updatedAt ?? price.updatedAt,
    };
  } catch {
    return price;
  }
}

/** Enabled only after LAUNCH.isLive + mint are set in config/launch.ts */
export function useAxmMarket() {
  const enabled = isLaunchLive();
  return useQuery({
    queryKey: ["axiom-market", enabled],
    queryFn: ({ signal }) => loadMarket(signal),
    enabled,
    staleTime: MARKET_STALE_MS,
    refetchInterval: enabled ? MARKET_REFETCH_MS : false,
    retry: 2,
    placeholderData: EMPTY_MARKET,
  });
}
