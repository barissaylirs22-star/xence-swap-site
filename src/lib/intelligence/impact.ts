/**
 * Token Intelligence price-impact thresholds (percent).
 * Shared by Risk V1 and explainability — do not diverge.
 */
export const INTEL_IMPACT_LOW_MAX = 1;
export const INTEL_IMPACT_MODERATE_MAX = 3;
export const INTEL_IMPACT_ELEVATED_MAX = 5;

export type IntelPriceImpactLevel =
  | "low"
  | "moderate"
  | "elevated"
  | "high"
  | "unknown";

/**
 * Normalize a Jupiter quote impact into percent points.
 * Jupiter may send a fraction (0.008 → 0.8%) or a percent (0.8 → 0.8%).
 * Heuristic: values ≤ 0.05 are treated as fractions; larger values as percent.
 * (0.05 as fraction = 5%; 0.05 as percent = 0.05% — rare; probe impacts are usually small percents.)
 *
 * Prefer: if value > 1, definitely percent. If value ≤ 1, Jupiter lite usually
 * already returns percent strings like "0.82". Multiplying those by 100 caused
 * false "high" labels — so TI treats ≤ 1 as already-percent unless clearly fractional.
 */
export function normalizeIntelImpactPercent(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const n = Math.abs(value);
  // Clear fraction form used by some payloads (e.g. 0.0008 → 0.08%).
  if (n > 0 && n < 0.0001) {
    return n * 100;
  }
  // Already percent points (including 0.8 meaning 0.8%).
  return n;
}

/**
 * Classify an already-normalized impact percent.
 * Does NOT re-normalize — callers must pass percent points once.
 */
export function classifyIntelPriceImpact(
  pct: number | null | undefined,
): IntelPriceImpactLevel {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return "unknown";
  }
  if (pct >= INTEL_IMPACT_ELEVATED_MAX) return "high";
  if (pct >= INTEL_IMPACT_MODERATE_MAX) return "elevated";
  if (pct >= INTEL_IMPACT_LOW_MAX) return "moderate";
  return "low";
}

export function resolveIntelPriceImpact(raw: number | null | undefined): {
  priceImpactPct: number | null;
  priceImpactLevel: IntelPriceImpactLevel;
} {
  const priceImpactPct = normalizeIntelImpactPercent(raw);
  return {
    priceImpactPct,
    priceImpactLevel: classifyIntelPriceImpact(priceImpactPct),
  };
}
