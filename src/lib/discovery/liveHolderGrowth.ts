/**
 * Compact Live holder-growth summary derived ONLY from existing
 * /api/holder-intel POST intel.growth (server computeHolderGrowth).
 * No client-side history replay. Display eligibility is separate from raw data.
 */

import type { HolderGrowthDelta, HolderHistoryWindow } from "@/lib/intelligence/types";

export interface LiveHolderGrowthSummary {
  absolute: number;
  percent: number;
  fromAt: number;
  /** Client receive/normalize time for the observation used as "current". */
  toAt: number;
  fromCount: number;
  toCount: number;
  /** Nominal server window key when present. */
  window: HolderHistoryWindow | null;
  /** Honest elapsed: toAt - fromAt (ms). */
  actualElapsedMs: number;
}

const WINDOW_PREF: HolderHistoryWindow[] = ["1h", "6h", "5m", "24h"];

function isWindow(value: unknown): value is HolderHistoryWindow {
  return value === "5m" || value === "1h" || value === "6h" || value === "24h";
}

function pickPreferredDelta(
  deltas: HolderGrowthDelta[],
): HolderGrowthDelta | null {
  if (!deltas.length) return null;
  for (const w of WINDOW_PREF) {
    const hit = deltas.find((d) => d.window === w);
    if (hit) return hit;
  }
  return deltas[0] ?? null;
}

/**
 * Normalize server intel.growth into one Live summary.
 * Returns null when growth is unavailable / building / empty.
 */
export function normalizeLiveHolderGrowth(
  intel: unknown,
  toAt = Date.now(),
): LiveHolderGrowthSummary | null {
  if (!intel || typeof intel !== "object") return null;
  const growth = (intel as { growth?: unknown }).growth;
  if (!growth || typeof growth !== "object") return null;

  const g = growth as {
    available?: unknown;
    deltas?: unknown;
  };
  if (g.available !== true || !Array.isArray(g.deltas) || g.deltas.length === 0) {
    return null;
  }

  const deltas: HolderGrowthDelta[] = [];
  for (const raw of g.deltas) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Partial<HolderGrowthDelta>;
    if (!isWindow(d.window)) continue;
    if (typeof d.absolute !== "number" || !Number.isFinite(d.absolute)) continue;
    if (typeof d.percent !== "number" || !Number.isFinite(d.percent)) continue;
    if (typeof d.fromAt !== "number" || !Number.isFinite(d.fromAt)) continue;
    if (typeof d.fromCount !== "number" || !Number.isFinite(d.fromCount)) continue;
    if (typeof d.toCount !== "number" || !Number.isFinite(d.toCount)) continue;
    deltas.push({
      window: d.window,
      absolute: d.absolute,
      percent: d.percent,
      fromAt: d.fromAt,
      fromCount: d.fromCount,
      toCount: d.toCount,
      line: typeof d.line === "string" ? d.line : "",
      detailLine: typeof d.detailLine === "string" ? d.detailLine : "",
    });
  }

  const preferred = pickPreferredDelta(deltas);
  if (!preferred) return null;

  const to = Number.isFinite(toAt) ? toAt : Date.now();
  const actualElapsedMs = Math.max(0, to - preferred.fromAt);

  return {
    absolute: preferred.absolute,
    percent: preferred.percent,
    fromAt: preferred.fromAt,
    toAt: to,
    fromCount: preferred.fromCount,
    toCount: preferred.toCount,
    window: preferred.window,
    actualElapsedMs,
  };
}

/** Audited Live display eligibility — does not mutate or discard raw summary. */
export function isLiveHolderGrowthSignificant(
  summary: LiveHolderGrowthSummary | null | undefined,
): boolean {
  if (!summary) return false;
  if (summary.fromCount < 20) return false;
  if (summary.actualElapsedMs < 5 * 60_000) return false;

  const abs = Math.abs(summary.absolute);
  const pct = Math.abs(summary.percent);

  if (summary.window === "5m") {
    return abs >= 25 && pct >= 5;
  }

  return abs >= 25 || pct >= 5;
}
