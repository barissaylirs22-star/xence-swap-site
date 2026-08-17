/**
 * Shared Holder Intelligence history core (Node Vite + Cloudflare Worker).
 * Pure compute + store mutations — no localStorage.
 * V2: 5m/1h/6h/24h windows, market fields on snapshots, pp concentration trends.
 */

export const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const RETENTION_MS = 48 * 60 * 60 * 1000;
export const MAX_SNAPSHOTS_PER_MINT = 200;
export const MAX_MINTS = 250;

/** High-res window: keep every snapshot. Older: downsample. */
export const HIGH_RES_MS = 6 * 60 * 60 * 1000;
export const LOW_RES_MIN_GAP_MS = 15 * 60 * 1000;

export const HOLDER_GROWTH_WINDOWS = {
  m5: 5 * 60 * 1000,
  h1: 60 * 60 * 1000,
  h6: 6 * 60 * 60 * 1000,
  h24: 24 * 60 * 60 * 1000,
};

/**
 * Max distance from the exact target timestamp for a window comparison.
 * If the nearest observation is farther than this, the window is omitted
 * (never extrapolated from a mismatched age).
 */
export const WINDOW_TOLERANCE = {
  m5: 2.5 * 60 * 1000, // target −5m ±2.5m → obs in [2.5m, 7.5m] ago
  h1: 15 * 60 * 1000, // target −1h ±15m → obs in [45m, 75m] ago
  h6: 90 * 60 * 1000, // target −6h ±90m → obs in [4.5h, 7.5h] ago
  h24: 3 * 60 * 60 * 1000, // target −24h ±3h → obs in [21h, 27h] ago
};

export const CONCENTRATION_STABLE_MAX_PP = 0.5;
export const CONCENTRATION_MATERIAL_PP = 1.0;
/** Stronger bar when only a short window is available for risk. */
export const CONCENTRATION_SHORT_RISK_PP = 1.5;
export const HOLDERS_FALLING_ABS = 25;
export const HOLDERS_FALLING_PCT = 5;
/** Rapid growth interpretation (≥ this % on 5m/1h). */
export const HOLDERS_RAPID_GROWTH_PCT = 10;
/** Stable growth band (absolute % change). */
export const HOLDERS_STABLE_PCT = 2;

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const WINDOW_KEYS = /** @type {const} */ (["m5", "h1", "h6", "h24"]);

/**
 * @typedef {{
 *   t: number,
 *   holderCount: number|null,
 *   topHolderPct: number|null,
 *   top10HolderPct: number|null,
 *   priceUsd?: number|null,
 *   liquidityUsd?: number|null,
 *   marketCapUsd?: number|null,
 * }} HolderObservation
 */

export function isValidMint(mint) {
  return typeof mint === "string" && MINT_RE.test(mint.trim());
}

function optionalFinite(raw, key) {
  if (!raw || raw[key] == null) return null;
  const n = Number(raw[key]);
  return Number.isFinite(n) ? n : null;
}

export function normalizeObservation(raw, t = Date.now()) {
  const holderCount =
    raw &&
    raw.holderCount != null &&
    Number.isFinite(Number(raw.holderCount))
      ? Math.round(Number(raw.holderCount))
      : null;
  const topHolderPct =
    raw &&
    raw.topHolderPct != null &&
    Number.isFinite(Number(raw.topHolderPct))
      ? Number(raw.topHolderPct)
      : null;
  const top10HolderPct =
    raw &&
    raw.top10HolderPct != null &&
    Number.isFinite(Number(raw.top10HolderPct))
      ? Number(raw.top10HolderPct)
      : null;

  return {
    t: typeof t === "number" && Number.isFinite(t) ? t : Date.now(),
    holderCount,
    topHolderPct,
    top10HolderPct,
    priceUsd: optionalFinite(raw, "priceUsd"),
    liquidityUsd: optionalFinite(raw, "liquidityUsd"),
    marketCapUsd: optionalFinite(raw, "marketCapUsd"),
  };
}

export function isUsableObservation(obs) {
  return (
    (obs.holderCount != null && Number.isFinite(obs.holderCount)) ||
    (obs.topHolderPct != null && Number.isFinite(obs.topHolderPct)) ||
    (obs.top10HolderPct != null && Number.isFinite(obs.top10HolderPct))
  );
}

/**
 * Retention: drop >48h, keep all within HIGH_RES_MS, downsample older to LOW_RES_MIN_GAP_MS,
 * then hard-cap MAX_SNAPSHOTS_PER_MINT.
 * @param {HolderObservation[]} series
 * @param {number} now
 */
export function pruneMintSeries(series, now) {
  const cutoff = now - RETENTION_MS;
  const sorted = (series || [])
    .filter((s) => s && typeof s.t === "number" && s.t >= cutoff)
    .sort((a, b) => a.t - b.t);

  const highResCut = now - HIGH_RES_MS;
  const out = [];
  let lastLowResT = -Infinity;

  for (const obs of sorted) {
    if (obs.t >= highResCut) {
      out.push(obs);
      continue;
    }
    if (obs.t - lastLowResT >= LOW_RES_MIN_GAP_MS) {
      out.push(obs);
      lastLowResT = obs.t;
    }
  }

  if (out.length <= MAX_SNAPSHOTS_PER_MINT) return out;
  return out.slice(out.length - MAX_SNAPSHOTS_PER_MINT);
}

function emptyGrowth(currentCount, building, recordedMs = null) {
  return {
    available: false,
    building,
    currentCount,
    deltas: [],
    primaryLine: null,
    recordedMs,
    statusLine: buildingStatusLine(recordedMs, building),
  };
}

function emptyWhale(building, recordedMs = null) {
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
    recordedMs,
    statusLine: buildingStatusLine(recordedMs, building),
  };
}

function buildingStatusLine(recordedMs, building) {
  if (!building) return null;
  if (recordedMs != null && recordedMs > 0) {
    return `Building history — ${formatDuration(recordedMs)} recorded`;
  }
  return "Building history...";
}

export function formatDuration(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 48) return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function findObservationNear(series, targetAt, toleranceMs, predicate) {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const obs of series) {
    if (!predicate(obs)) continue;
    const dist = Math.abs(obs.t - targetAt);
    if (dist <= toleranceMs && dist < bestDist) {
      best = obs;
      bestDist = dist;
    }
  }
  return best;
}

function trendFromDeltaPp(deltaPp) {
  if (Math.abs(deltaPp) < CONCENTRATION_STABLE_MAX_PP) return "stable";
  return deltaPp > 0 ? "increasing" : "decreasing";
}

function formatSigned(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function formatSignedPct(n) {
  const fixed = Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
  return n > 0 ? `+${fixed}%` : `${fixed}%`;
}

function formatSignedPp(n) {
  const abs = Math.abs(n);
  const fixed = abs >= 10 ? abs.toFixed(1) : abs.toFixed(1);
  if (n > 0) return `↑${fixed}pp`;
  if (n < 0) return `↓${fixed}pp`;
  return `0pp`;
}

function windowLabel(key) {
  if (key === "m5") return "5m";
  if (key === "h1") return "1h";
  if (key === "h6") return "6h";
  return "24h";
}

function windowKeyFromLabel(label) {
  if (label === "5m") return "m5";
  if (label === "1h") return "h1";
  if (label === "6h") return "h6";
  return "h24";
}

function recordedSpanMs(series, current) {
  if (!series.length) return 0;
  const first = series[0];
  if (!first || typeof first.t !== "number") return 0;
  return Math.max(0, current.t - first.t);
}

/**
 * @param {HolderObservation[]} series older-only
 * @param {HolderObservation} current
 */
export function computeHolderGrowth(series, current) {
  const recordedMs = recordedSpanMs(series, current);
  const currentCount = current.holderCount;
  if (currentCount == null || !Number.isFinite(currentCount)) {
    return emptyGrowth(null, series.length === 0, recordedMs || null);
  }

  const deltas = [];
  for (const key of WINDOW_KEYS) {
    const windowMs = HOLDER_GROWTH_WINDOWS[key];
    const targetAt = current.t - windowMs;
    const prior = findObservationNear(
      series,
      targetAt,
      WINDOW_TOLERANCE[key],
      (obs) => obs.holderCount != null && Number.isFinite(obs.holderCount),
    );
    if (!prior || prior.holderCount == null) continue;
    if (prior.t >= current.t) continue;
    if (prior.holderCount <= 0) continue;

    const absolute = currentCount - prior.holderCount;
    const percent = (absolute / prior.holderCount) * 100;
    deltas.push({
      window: windowLabel(key),
      absolute,
      percent,
      fromAt: prior.t,
      fromCount: prior.holderCount,
      toCount: currentCount,
      line: `${windowLabel(key)}  ${formatSignedPct(percent)}`,
      detailLine: `${windowLabel(key)}: ${currentCount.toLocaleString("en-US")} holders · ${formatSigned(absolute)} · ${formatSignedPct(percent)}`,
    });
  }

  if (!deltas.length) {
    return emptyGrowth(currentCount, true, recordedMs || null);
  }

  const preferred =
    deltas.find((d) => d.window === "1h") ??
    deltas.find((d) => d.window === "6h") ??
    deltas.find((d) => d.window === "5m") ??
    deltas[0];

  const primaryLine = `${currentCount.toLocaleString("en-US")} holders · ${formatSigned(preferred.absolute)} in ${preferred.window} · ${formatSignedPct(preferred.percent)}`;

  return {
    available: true,
    building: false,
    currentCount,
    deltas,
    primaryLine,
    recordedMs: recordedMs || null,
    statusLine: null,
  };
}

/**
 * Per-window largest / top10 concentration deltas (percentage points).
 * @param {HolderObservation[]} series
 * @param {HolderObservation} current
 */
export function computeWhaleMovement(series, current) {
  const recordedMs = recordedSpanMs(series, current);
  const hasCurrentConc =
    (current.topHolderPct != null && Number.isFinite(current.topHolderPct)) ||
    (current.top10HolderPct != null && Number.isFinite(current.top10HolderPct));

  if (!hasCurrentConc) {
    return emptyWhale(series.length === 0, recordedMs || null);
  }

  /** @type {Array<{
   *   window: string,
   *   largestFrom: number|null,
   *   largestTo: number|null,
   *   largestDeltaPp: number|null,
   *   top10From: number|null,
   *   top10To: number|null,
   *   top10DeltaPp: number|null,
   *   fromAt: number,
   *   largestLine: string|null,
   *   top10Line: string|null,
   * }>} */
  const windows = [];

  for (const key of WINDOW_KEYS) {
    const windowMs = HOLDER_GROWTH_WINDOWS[key];
    const targetAt = current.t - windowMs;
    const prior = findObservationNear(
      series,
      targetAt,
      WINDOW_TOLERANCE[key],
      (obs) =>
        (obs.topHolderPct != null && Number.isFinite(obs.topHolderPct)) ||
        (obs.top10HolderPct != null && Number.isFinite(obs.top10HolderPct)),
    );
    if (!prior || prior.t >= current.t) continue;

    const largestDeltaPp =
      current.topHolderPct != null &&
      prior.topHolderPct != null &&
      Number.isFinite(current.topHolderPct) &&
      Number.isFinite(prior.topHolderPct)
        ? current.topHolderPct - prior.topHolderPct
        : null;

    const top10DeltaPp =
      current.top10HolderPct != null &&
      prior.top10HolderPct != null &&
      Number.isFinite(current.top10HolderPct) &&
      Number.isFinite(prior.top10HolderPct)
        ? current.top10HolderPct - prior.top10HolderPct
        : null;

    if (largestDeltaPp == null && top10DeltaPp == null) continue;

    const label = windowLabel(key);
    let largestLine = null;
    if (
      largestDeltaPp != null &&
      prior.topHolderPct != null &&
      current.topHolderPct != null
    ) {
      largestLine = `Largest ${label}  ${prior.topHolderPct.toFixed(1)}%→${current.topHolderPct.toFixed(1)}% · ${formatSignedPp(largestDeltaPp)}`;
    }
    let top10Line = null;
    if (
      top10DeltaPp != null &&
      prior.top10HolderPct != null &&
      current.top10HolderPct != null
    ) {
      top10Line = `Top 10 ${label}  ${prior.top10HolderPct.toFixed(1)}%→${current.top10HolderPct.toFixed(1)}% · ${formatSignedPp(top10DeltaPp)}`;
    }

    windows.push({
      window: label,
      largestFrom: prior.topHolderPct ?? null,
      largestTo: current.topHolderPct ?? null,
      largestDeltaPp,
      top10From: prior.top10HolderPct ?? null,
      top10To: current.top10HolderPct ?? null,
      top10DeltaPp,
      fromAt: prior.t,
      largestLine,
      top10Line,
    });
  }

  if (!windows.length) {
    return emptyWhale(true, recordedMs || null);
  }

  const preferred =
    windows.find((w) => w.window === "1h") ??
    windows.find((w) => w.window === "6h") ??
    windows.find((w) => w.window === "5m") ??
    windows[0];

  const largestDeltaPp = preferred.largestDeltaPp;
  const top10DeltaPp = preferred.top10DeltaPp;
  const largestTrend =
    largestDeltaPp != null ? trendFromDeltaPp(largestDeltaPp) : null;
  const top10Trend =
    top10DeltaPp != null ? trendFromDeltaPp(top10DeltaPp) : null;

  const signals = [];

  if (largestTrend === "increasing" && largestDeltaPp != null) {
    if (Math.abs(largestDeltaPp) >= CONCENTRATION_MATERIAL_PP) {
      signals.push("Ownership becoming more concentrated");
      signals.push(
        `Largest holder ${formatSignedPp(largestDeltaPp)} (${preferred.window})`,
      );
    } else {
      signals.push("Whale concentration increasing");
    }
  } else if (largestTrend === "decreasing" && largestDeltaPp != null) {
    signals.push(
      `Largest holder share ${formatSignedPp(largestDeltaPp)} (${preferred.window})`,
    );
    if (Math.abs(largestDeltaPp) >= CONCENTRATION_MATERIAL_PP) {
      signals.push("Whale concentration decreasing");
    }
  }

  if (top10Trend === "decreasing" && top10DeltaPp != null) {
    signals.push(
      `Top 10 ${formatSignedPp(top10DeltaPp)} (${preferred.window})`,
    );
    if (Math.abs(top10DeltaPp) >= CONCENTRATION_MATERIAL_PP) {
      signals.push("Distribution becoming healthier");
    }
  } else if (top10Trend === "increasing" && top10DeltaPp != null) {
    if (Math.abs(top10DeltaPp) >= CONCENTRATION_MATERIAL_PP) {
      signals.push("Ownership becoming more concentrated");
      signals.push("Whale concentration increasing");
    } else {
      signals.push(
        `Top 10 ${formatSignedPp(top10DeltaPp)} (${preferred.window})`,
      );
    }
  }

  if (
    largestTrend === "stable" &&
    (top10Trend === "stable" || top10Trend == null) &&
    signals.length === 0
  ) {
    signals.push("Whale concentration stable");
  }

  return {
    available: true,
    building: false,
    largestTrend,
    top10Trend,
    largestDeltaPp,
    top10DeltaPp,
    comparedAt: preferred.fromAt,
    preferredWindow: preferred.window,
    windows,
    signals: [...new Set(signals)],
    recordedMs: recordedMs || null,
    statusLine: null,
  };
}

/**
 * Evidence-based observation labels (not investment advice).
 */
export function buildInterpretations(growth, whale) {
  const out = [];

  if (growth?.available && growth.deltas?.length) {
    const short =
      growth.deltas.find((d) => d.window === "1h") ??
      growth.deltas.find((d) => d.window === "5m") ??
      growth.deltas[0];
    if (short.percent >= HOLDERS_RAPID_GROWTH_PCT) {
      out.push("Holder base growing rapidly");
    } else if (short.percent <= -HOLDERS_FALLING_PCT) {
      out.push("Holder count declining");
    } else if (Math.abs(short.percent) <= HOLDERS_STABLE_PCT) {
      out.push("Holder growth stable");
    } else if (short.percent > 0) {
      out.push("Holder base growing");
    } else if (short.percent < 0) {
      out.push("Holder count declining");
    }
  }

  if (whale?.available) {
    const materialLargest =
      whale.largestDeltaPp != null &&
      Math.abs(whale.largestDeltaPp) >= CONCENTRATION_MATERIAL_PP;
    const materialTop10 =
      whale.top10DeltaPp != null &&
      Math.abs(whale.top10DeltaPp) >= CONCENTRATION_MATERIAL_PP;

    if (whale.largestTrend === "increasing" && materialLargest) {
      out.push("Ownership becoming more concentrated");
    } else if (whale.largestTrend === "decreasing" && materialLargest) {
      out.push("Whale concentration decreasing");
    }

    if (whale.top10Trend === "increasing" && materialTop10) {
      out.push("Whale concentration increasing");
    } else if (whale.top10Trend === "decreasing" && materialTop10) {
      out.push("Distribution becoming healthier");
    }
  }

  return [...new Set(out)];
}

/**
 * Apply an observation to a series (interval-gated). Returns updated series + write flag.
 * @param {HolderObservation[]} series
 * @param {HolderObservation} nextObs
 * @param {number} now
 */
export function applyObservation(series, nextObs, now = Date.now()) {
  if (!isUsableObservation(nextObs)) {
    return { series: pruneMintSeries(series, now), wrote: false, latest: null };
  }

  const sorted = pruneMintSeries(series, now);
  const last = sorted[sorted.length - 1];
  if (last && nextObs.t - last.t < SNAPSHOT_MIN_INTERVAL_MS) {
    // Merge optional market fields onto the latest row when throttled (no new timestamp).
    if (
      last &&
      ((nextObs.priceUsd != null && last.priceUsd == null) ||
        (nextObs.liquidityUsd != null && last.liquidityUsd == null) ||
        (nextObs.marketCapUsd != null && last.marketCapUsd == null))
    ) {
      const merged = {
        ...last,
        priceUsd: last.priceUsd ?? nextObs.priceUsd ?? null,
        liquidityUsd: last.liquidityUsd ?? nextObs.liquidityUsd ?? null,
        marketCapUsd: last.marketCapUsd ?? nextObs.marketCapUsd ?? null,
      };
      const updated = pruneMintSeries(
        [...sorted.slice(0, -1), merged],
        now,
      );
      return { series: updated, wrote: false, latest: merged };
    }
    return { series: sorted, wrote: false, latest: last };
  }

  const updated = pruneMintSeries([...sorted, nextObs], now);
  return { series: updated, wrote: true, latest: nextObs };
}

/**
 * Build intelligence from current live obs + historical series (excluding current).
 * @param {HolderObservation[]} historical
 * @param {HolderObservation} currentObs
 * @param {{ wrote?: boolean, snapshotCount?: number }} meta
 */
export function buildIntelFromSeries(historical, currentObs, meta = {}) {
  const seriesForCompare = historical.filter((obs) => obs.t < currentObs.t);
  const growth = computeHolderGrowth(seriesForCompare, currentObs);
  const whale = computeWhaleMovement(seriesForCompare, currentObs);
  const interpretations = buildInterpretations(growth, whale);
  const last = historical[historical.length - 1];
  const recordedMs = recordedSpanMs(
    historical.length ? historical : seriesForCompare,
    currentObs,
  );

  return {
    growth,
    whale,
    interpretations,
    recordedMs: recordedMs || null,
    snapshotCount: meta.snapshotCount ?? historical.length,
    lastSnapshotAt: last?.t ?? currentObs.t,
    persisted: Boolean(meta.wrote),
  };
}

export { windowLabel, windowKeyFromLabel, formatSignedPp, formatSignedPct };
