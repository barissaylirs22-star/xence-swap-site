export type PriceImpactLevel = "low" | "elevated" | "high" | "unknown";

/** Jupiter may return a fraction (0.01) or a percent (1). Normalize to percent. */
export function normalizeImpactPercent(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return value <= 1 ? value * 100 : value;
}

export function classifyPriceImpact(
  value: number | null | undefined,
): PriceImpactLevel {
  const pct = normalizeImpactPercent(value);
  if (pct === null) return "unknown";
  if (pct >= 5) return "high";
  if (pct >= 1) return "elevated";
  return "low";
}
