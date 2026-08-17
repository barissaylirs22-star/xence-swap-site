import { getActiveMint, isLaunchLive } from "@/config/launch";
import { JUPITER_API_BASE, JUPITER_PRICE_PATH } from "@/config/providers";
import type { AxmMarketSnapshot } from "@/types/market";
import { EMPTY_MARKET } from "@/types/market";

interface JupiterPriceEntry {
  usdPrice?: number;
  liquidity?: number;
  priceChange24h?: number | null;
}

type JupiterPriceResponse = Record<string, JupiterPriceEntry>;

/** Fetches price only when launch is live and a mint is configured. */
export async function fetchLiveTokenPrice(
  signal?: AbortSignal,
): Promise<AxmMarketSnapshot> {
  if (!isLaunchLive()) {
    return { ...EMPTY_MARKET, error: null };
  }

  const mint = getActiveMint();
  if (!mint) {
    return { ...EMPTY_MARKET, error: null };
  }

  const url = new URL(JUPITER_PRICE_PATH, JUPITER_API_BASE);
  url.searchParams.set("ids", mint);

  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Jupiter Price API error (${res.status})`);
  }

  const data = (await res.json()) as JupiterPriceResponse;
  const entry = data[mint];

  if (!entry || typeof entry.usdPrice !== "number") {
    return {
      ...EMPTY_MARKET,
      sources: ["jupiter-price-v3"],
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    priceUsd: entry.usdPrice,
    priceChange24h:
      typeof entry.priceChange24h === "number" ? entry.priceChange24h : null,
    liquidityUsd: typeof entry.liquidity === "number" ? entry.liquidity : null,
    volume24hUsd: null,
    marketCapUsd: null,
    sources: ["jupiter-price-v3"],
    updatedAt: new Date().toISOString(),
    error: null,
  };
}
