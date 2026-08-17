import { DEFAULT_SLIPPAGE_BPS } from "@/config/providers";
import { getCached, setCached } from "@/lib/market/cache";
import { getSwapRouter } from "@/lib/swap/createRouter";
import { SOL_MINT } from "@/lib/tokens/catalog";
import {
  resolveIntelPriceImpact,
  type IntelPriceImpactLevel,
} from "./impact";

const ROUTE_CACHE_MS = 45_000;
/** Fixed probe size: 0.01 SOL — discovery only, never executed. */
const PROBE_SOL_RAW = "10000000";

export interface RouteProbeSnapshot {
  routeAvailable: boolean;
  priceImpactPct: number | null;
  priceImpactLevel: IntelPriceImpactLevel;
  updatedAt: number;
}

function cacheKey(mint: string): string {
  return `intel:route:v2:${mint}`;
}

/**
 * Lightweight Jupiter quote probe (SOL → mint) to test route availability.
 * Fail soft — never throws into callers for missing routes.
 */
export async function probeJupiterRoute(
  mint: string,
  signal?: AbortSignal,
): Promise<RouteProbeSnapshot | null> {
  if (!mint || mint === SOL_MINT) {
    return {
      routeAvailable: true,
      priceImpactPct: 0,
      priceImpactLevel: "low",
      updatedAt: Date.now(),
    };
  }

  const cached = getCached<RouteProbeSnapshot>(cacheKey(mint));
  if (cached) return cached;

  const router = getSwapRouter();
  if (!router) {
    return null;
  }

  try {
    const quote = await router.getQuote({
      inputMint: SOL_MINT,
      outputMint: mint,
      amountRaw: PROBE_SOL_RAW,
      slippageBps: DEFAULT_SLIPPAGE_BPS,
      signal,
    });

    const impact = resolveIntelPriceImpact(quote.priceImpactPct);
    const snapshot: RouteProbeSnapshot = {
      routeAvailable: true,
      priceImpactPct: impact.priceImpactPct,
      priceImpactLevel: impact.priceImpactLevel,
      updatedAt: Date.now(),
    };
    setCached(cacheKey(mint), snapshot, ROUTE_CACHE_MS);
    return snapshot;
  } catch {
    const snapshot: RouteProbeSnapshot = {
      routeAvailable: false,
      priceImpactPct: null,
      priceImpactLevel: "unknown",
      updatedAt: Date.now(),
    };
    setCached(cacheKey(mint), snapshot, ROUTE_CACHE_MS);
    return snapshot;
  }
}
