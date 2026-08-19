import type { RiskLevel } from "@/lib/intelligence/types";
import type { TokenAsset } from "@/lib/tokens/types";
import { resolveLiveAxiomScore } from "./resolvedAxiomScore";
import type { LiveHolderGrowthSummary } from "./liveHolderGrowth";

export type DiscoveryFilterId =
  | "trending"
  | "new"
  | "high_volume"
  | "most_holders"
  | "low_risk"
  | "axm_score"
  | "pump";

export interface DiscoveryEnrichment {
  holderCount: number | null;
  topHolderPct: number | null;
  top10HolderPct: number | null;
  riskLevel: RiskLevel | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  /**
   * Compact growth from the same holder-intel POST (may arrive async).
   * null = unavailable / building / POST not finished or failed.
   */
  holderGrowth: LiveHolderGrowthSummary | null;
}

export const DISCOVERY_FILTERS: Array<{
  id: DiscoveryFilterId;
  title: string;
}> = [
  { id: "trending", title: "Trending" },
  { id: "new", title: "New" },
  { id: "high_volume", title: "High Volume" },
  { id: "most_holders", title: "Most Holders" },
  { id: "low_risk", title: "Low Risk" },
  { id: "axm_score", title: "AXM Score" },
  { id: "pump", title: "Pump.fun" },
];

/** Initial visible rows; more load on scroll. */
export const DISCOVERY_PAGE_SIZE = 20;

function log1p(n: number): number {
  return Math.log1p(Math.max(0, n));
}

/**
 * Explainable trending score from real Dex metrics only.
 * Missing fields contribute 0 — never invented.
 */
export function trendingScore(token: TokenAsset, now = Date.now()): number {
  const vol = token.volume24hUsd;
  const liq = token.liquidityUsd;
  const ch =
    token.priceChange1hPct ?? token.priceChange5mPct ?? token.priceChange24hPct;
  const ageMs =
    token.listedAt != null && Number.isFinite(token.listedAt)
      ? Math.max(0, now - token.listedAt)
      : null;

  let score = 0;
  if (vol != null && Number.isFinite(vol)) score += 0.4 * log1p(vol);
  if (liq != null && Number.isFinite(liq)) score += 0.25 * log1p(liq);
  if (ch != null && Number.isFinite(ch)) score += 0.2 * Math.min(Math.abs(ch), 100);
  if (ageMs != null && ageMs < 72 * 60 * 60 * 1000) {
    // Fresher listings get a small boost when they also have volume/liq.
    const freshness = 1 - ageMs / (72 * 60 * 60 * 1000);
    score += 0.15 * freshness * (vol != null || liq != null ? 1 : 0.25);
  } else if (token.isFresh) {
    score += 0.05;
  }
  return score;
}

/**
 * Filter + rank a discovery universe for a non-pump tab.
 * Enrichment is optional — Most Holders / Low Risk only include tokens with real values.
 */
export function applyDiscoveryFilter(
  tokens: TokenAsset[],
  filter: DiscoveryFilterId,
  enrichment: Map<string, DiscoveryEnrichment>,
  now = Date.now(),
): TokenAsset[] {
  const list = tokens.filter((t) => t.selectable && t.mint);

  switch (filter) {
    case "trending":
      return [...list].sort(
        (a, b) => trendingScore(b, now) - trendingScore(a, now),
      );

    case "new":
      return [...list].sort((a, b) => {
        const at = a.listedAt ?? 0;
        const bt = b.listedAt ?? 0;
        if (bt !== at) return bt - at;
        const af = a.isFresh ? 1 : 0;
        const bf = b.isFresh ? 1 : 0;
        return bf - af;
      });

    case "high_volume":
      return [...list]
        .filter(
          (t) => t.volume24hUsd != null && Number.isFinite(t.volume24hUsd),
        )
        .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));

    case "most_holders":
      return [...list]
        .filter((t) => {
          const e = enrichment.get(t.mint);
          return e?.holderCount != null && Number.isFinite(e.holderCount);
        })
        .sort(
          (a, b) =>
            (enrichment.get(b.mint)?.holderCount ?? 0) -
            (enrichment.get(a.mint)?.holderCount ?? 0),
        );

    case "low_risk":
      return [...list]
        .filter((t) => enrichment.get(t.mint)?.riskLevel === "LOW")
        .sort(
          (a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0),
        );

    case "axm_score":
      return [...list].sort((a, b) => {
        const sa =
          resolveLiveAxiomScore(a, enrichment.get(a.mint), now)?.score ?? -1;
        const sb =
          resolveLiveAxiomScore(b, enrichment.get(b.mint), now)?.score ?? -1;
        if (sb !== sa) return sb - sa;
        return (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0);
      });

    case "pump":
      return list;

    default:
      return list;
  }
}
