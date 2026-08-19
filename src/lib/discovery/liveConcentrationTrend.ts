/**
 * Compact LIVE concentration-trend summary from holder-intel whale facts.
 * Same POST/GET body already used for growth — no new persistence.
 */

import type {
  ConcentrationTrend,
  HolderHistoryWindow,
} from "@/lib/intelligence/types";

export interface LiveConcentrationTrendSummary {
  available: boolean;
  largestTrend: ConcentrationTrend | null;
  top10Trend: ConcentrationTrend | null;
  largestDeltaPp: number | null;
  top10DeltaPp: number | null;
  preferredWindow: HolderHistoryWindow | null;
  comparedAt: number | null;
  signals: string[];
}

function isWindow(value: unknown): value is HolderHistoryWindow {
  return value === "5m" || value === "1h" || value === "6h" || value === "24h";
}

function isTrend(value: unknown): value is ConcentrationTrend {
  return (
    value === "increasing" || value === "decreasing" || value === "stable"
  );
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Normalize intel.whale into a LIVE-safe trend summary.
 * Returns null when unavailable / building / empty.
 */
export function normalizeLiveConcentrationTrend(
  intel: unknown,
): LiveConcentrationTrendSummary | null {
  if (!intel || typeof intel !== "object") return null;
  const whale = (intel as { whale?: unknown }).whale;
  if (!whale || typeof whale !== "object") return null;

  const w = whale as Record<string, unknown>;
  if (w.available !== true || w.building === true) return null;

  const largestTrend = isTrend(w.largestTrend) ? w.largestTrend : null;
  const top10Trend = isTrend(w.top10Trend) ? w.top10Trend : null;
  const largestDeltaPp = finite(w.largestDeltaPp) ? w.largestDeltaPp : null;
  const top10DeltaPp = finite(w.top10DeltaPp) ? w.top10DeltaPp : null;
  const preferredWindow = isWindow(w.preferredWindow)
    ? w.preferredWindow
    : null;
  const comparedAt = finite(w.comparedAt) ? w.comparedAt : null;
  const signals = Array.isArray(w.signals)
    ? w.signals.filter((s): s is string => typeof s === "string")
    : [];

  if (
    largestTrend == null &&
    top10Trend == null &&
    largestDeltaPp == null &&
    top10DeltaPp == null
  ) {
    return null;
  }

  return {
    available: true,
    largestTrend,
    top10Trend,
    largestDeltaPp,
    top10DeltaPp,
    preferredWindow,
    comparedAt,
    signals,
  };
}
