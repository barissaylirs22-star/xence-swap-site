/**
 * Holder Intelligence V2 — client bridge to server-side history.
 * Source of truth: POST/GET /api/holder-intel (Vite file store or CF KV).
 * localStorage is NOT used.
 */

import type {
  HolderGrowthFacts,
  HolderIntelV2Facts,
  WhaleMovementFacts,
} from "./types";

/** Re-exported thresholds used by risk/explain (must match server/holderIntel/core.mjs). */
export const HOLDER_GROWTH_WINDOWS = {
  m5: 5 * 60 * 1000,
  h1: 60 * 60 * 1000,
  h6: 6 * 60 * 60 * 1000,
  h24: 24 * 60 * 60 * 1000,
} as const;

export const WINDOW_TOLERANCE = {
  m5: 2.5 * 60 * 1000,
  h1: 15 * 60 * 1000,
  h6: 90 * 60 * 1000,
  h24: 3 * 60 * 60 * 1000,
} as const;

export const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const CONCENTRATION_STABLE_MAX_PP = 0.5;
export const CONCENTRATION_MATERIAL_PP = 1.0;
export const CONCENTRATION_SHORT_RISK_PP = 1.5;
export const HOLDERS_FALLING_ABS = 25;
export const HOLDERS_FALLING_PCT = 5;

export const HOLDER_INTEL_API_PATH = "/api/holder-intel";

export interface HolderObservation {
  t: number;
  holderCount: number | null;
  topHolderPct: number | null;
  top10HolderPct: number | null;
  priceUsd?: number | null;
  liquidityUsd?: number | null;
  marketCapUsd?: number | null;
}

export type HolderIntelV2 = HolderIntelV2Facts;

function emptyGrowth(
  currentCount: number | null,
  building: boolean,
): HolderGrowthFacts {
  return {
    available: false,
    building,
    currentCount,
    deltas: [],
    primaryLine: null,
    recordedMs: null,
    statusLine: building ? "Building history..." : null,
  };
}

function emptyWhale(building: boolean): WhaleMovementFacts {
  return {
    available: false,
    building,
    largestTrend: null,
    top10Trend: null,
    largestDeltaPp: null,
    top10DeltaPp: null,
    comparedAt: null,
    preferredWindow: null,
    windows: [],
    signals: [],
    recordedMs: null,
    statusLine: building ? "Building history..." : null,
  };
}

function buildingIntel(currentCount: number | null): HolderIntelV2Facts {
  return {
    growth: emptyGrowth(currentCount, true),
    whale: emptyWhale(true),
    interpretations: [],
    recordedMs: null,
    snapshotCount: 0,
    lastSnapshotAt: null,
  };
}

function normalizeIntel(
  raw: unknown,
  fallbackCount: number | null,
): HolderIntelV2Facts {
  if (!raw || typeof raw !== "object") {
    return buildingIntel(fallbackCount);
  }
  const intel = raw as Partial<HolderIntelV2Facts> & {
    persisted?: boolean;
  };
  if (!intel.growth || !intel.whale) {
    return buildingIntel(fallbackCount);
  }
  return {
    growth: {
      ...emptyGrowth(fallbackCount, Boolean(intel.growth.building)),
      ...intel.growth,
      deltas: Array.isArray(intel.growth.deltas)
        ? intel.growth.deltas.map(normalizeGrowthDelta)
        : [],
    },
    whale: {
      ...emptyWhale(Boolean(intel.whale.building)),
      ...intel.whale,
      windows: Array.isArray(intel.whale.windows) ? intel.whale.windows : [],
      signals: Array.isArray(intel.whale.signals) ? intel.whale.signals : [],
    },
    interpretations: Array.isArray(intel.interpretations)
      ? intel.interpretations
      : [],
    recordedMs:
      typeof intel.recordedMs === "number" ? intel.recordedMs : null,
    snapshotCount:
      typeof intel.snapshotCount === "number" ? intel.snapshotCount : 0,
    lastSnapshotAt:
      typeof intel.lastSnapshotAt === "number" ? intel.lastSnapshotAt : null,
  };
}

function normalizeGrowthDelta(raw: unknown): HolderGrowthFacts["deltas"][number] {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<
    HolderGrowthFacts["deltas"][number]
  >;
  const window =
    d.window === "5m" || d.window === "1h" || d.window === "6h" || d.window === "24h"
      ? d.window
      : "1h";
  const absolute = typeof d.absolute === "number" && Number.isFinite(d.absolute) ? d.absolute : 0;
  const percent = typeof d.percent === "number" && Number.isFinite(d.percent) ? d.percent : 0;
  const fromAt = typeof d.fromAt === "number" && Number.isFinite(d.fromAt) ? d.fromAt : 0;
  const fromCount =
    typeof d.fromCount === "number" && Number.isFinite(d.fromCount) ? d.fromCount : 0;
  const toCount =
    typeof d.toCount === "number" && Number.isFinite(d.toCount) ? d.toCount : 0;
  const signed =
    percent > 0 ? `+${percent.toFixed(Math.abs(percent) >= 10 ? 1 : 2)}%` : `${percent.toFixed(Math.abs(percent) >= 10 ? 1 : 2)}%`;
  const line =
    typeof d.line === "string" && d.line.length > 0 ? d.line : `${window}  ${signed}`;
  const detailLine =
    typeof d.detailLine === "string" && d.detailLine.length > 0
      ? d.detailLine
      : `${window}: ${toCount.toLocaleString("en-US")} holders · ${absolute > 0 ? `+${absolute}` : `${absolute}`} · ${signed}`;
  return {
    window,
    absolute,
    percent,
    fromAt,
    fromCount,
    toCount,
    line,
    detailLine,
  };
}

/**
 * Record a real observation (server-throttled) and return growth + whale facts
 * computed from Axiom's persistent snapshot history.
 */
export async function buildHolderIntelV2(
  mint: string,
  current: {
    holderCount: number | null;
    topHolderPct: number | null;
    top10HolderPct: number | null;
    priceUsd?: number | null;
    liquidityUsd?: number | null;
    marketCapUsd?: number | null;
  },
  signal?: AbortSignal,
): Promise<HolderIntelV2Facts> {
  const trimmed = mint.trim();
  const fallbackCount =
    current.holderCount != null && Number.isFinite(current.holderCount)
      ? Math.round(current.holderCount)
      : null;

  if (!trimmed) return buildingIntel(fallbackCount);

  try {
    const res = await fetch(HOLDER_INTEL_API_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mint: trimmed,
        observation: {
          holderCount: current.holderCount,
          topHolderPct: current.topHolderPct,
          top10HolderPct: current.top10HolderPct,
          priceUsd: current.priceUsd ?? null,
          liquidityUsd: current.liquidityUsd ?? null,
          marketCapUsd: current.marketCapUsd ?? null,
        },
      }),
      signal,
    });

    if (!res.ok) {
      return buildingIntel(fallbackCount);
    }

    const json = (await res.json()) as { intel?: unknown };
    return normalizeIntel(json.intel, fallbackCount);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    return buildingIntel(fallbackCount);
  }
}

/** Optional read-only history fetch (no write). */
export async function fetchHolderIntelHistory(
  mint: string,
  signal?: AbortSignal,
): Promise<{
  snapshots: HolderObservation[];
  intel: HolderIntelV2Facts;
} | null> {
  const trimmed = mint.trim();
  if (!trimmed) return null;
  try {
    const url = `${HOLDER_INTEL_API_PATH}?mint=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, { method: "GET", signal });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      snapshots?: HolderObservation[];
      intel?: unknown;
    };
    return {
      snapshots: Array.isArray(json.snapshots) ? json.snapshots : [],
      intel: normalizeIntel(json.intel, null),
    };
  } catch {
    return null;
  }
}
