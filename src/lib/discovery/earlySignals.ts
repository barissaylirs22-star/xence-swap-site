/**
 * Early Signals V1 — discrete, explainable change cues.
 *
 * NOT a price prediction. NOT AXM Score. NOT Risk Analysis.
 * Pure function over TokenAsset + DiscoveryEnrichment (+ optional Detail whale).
 * Zero network I/O.
 *
 * Answers: "What meaningful changes are beginning to appear right now?"
 * Missing data never invents positive or caution signals.
 */

import type { TokenAsset } from "@/lib/tokens/types";
import type {
  WhaleActivityEvent,
  WhaleActivityFacts,
} from "@/lib/intelligence/types";
import {
  RISK_TOP10_HIGH_PCT,
  RISK_TOP_HOLDER_HIGH_PCT,
} from "@/lib/intelligence/risk";
import {
  isLiveHolderGrowthSignificant,
  type LiveHolderGrowthSummary,
} from "./liveHolderGrowth";
import type { LiveConcentrationTrendSummary } from "./liveConcentrationTrend";
import type { DiscoveryEnrichment } from "./filters";

/** Concentration Δ floor (percentage points) — aligned with Radar. */
export const EARLY_CONCENTRATION_PP = 2.0;

/** New-token traction window. */
export const EARLY_NEW_TOKEN_MS = 72 * 60 * 60 * 1000;
export const EARLY_TRACTION_VOLUME_USD = 10_000;
export const EARLY_TRACTION_LIQUIDITY_USD = 5_000;

/** Legacy Radar thresholds (not Early Signal triggers). */
export const EARLY_SPIKE_PCT = 80;
export const EARLY_VOLUME_ACTIVE_USD = 25_000;

export type EarlySignalKindId =
  | "structure_building"
  | "holder_momentum"
  | "distribution_improving"
  | "concentration_rising"
  | "new_token_traction"
  | "whale_distribution_alert";

export type EarlySignalTone = "positive" | "caution";

export type EarlySignalsMaturity =
  | "BUILDING_HISTORY"
  | "INSUFFICIENT_DATA"
  | "ACTIVE"
  | "NONE";

/** Legacy composite levels — kept for Radar / filter compatibility. */
export type EarlySignalLevel = "none" | "early" | "building" | "strong";

export type EarlySignalConfirmationId = EarlySignalKindId;

export interface EarlySignalConfirmation {
  id: EarlySignalConfirmationId;
  message: string;
}

export interface EarlySignalKind {
  id: EarlySignalKindId;
  label: string;
  tone: EarlySignalTone;
  explanation: string;
}

export interface EarlySignalResult {
  maturity: EarlySignalsMaturity;
  /** All active kinds after suppression + structure dedupe (priority-sorted). */
  signals: EarlySignalKind[];
  /** Live: highest-priority badge. */
  livePrimary: EarlySignalKind | null;
  /** Live: optional coexisting caution (when primary is positive). */
  liveCaution: EarlySignalKind | null;
  /** Detail: up to 3. */
  detailSignals: EarlySignalKind[];
  suppressed: boolean;
  suppressReason: string | null;
  enrichmentReady: boolean;
  /** Compatibility composite. */
  level: EarlySignalLevel;
  /** Compatibility badge — prefer named livePrimary.label when present. */
  label: string | null;
  confirmations: EarlySignalConfirmation[];
}

export interface AssessEarlySignalsOptions {
  now?: number;
  /** Token Detail whale facts — never fetched by this module. */
  whaleActivity?: WhaleActivityFacts | null;
  /** When true, evaluate Detail-only whale_distribution_alert. */
  includeWhale?: boolean;
  mintAuthorityActive?: boolean | null;
  freezeAuthorityActive?: boolean | null;
  /**
   * Explicit history-building hint (Detail holderIntel.growth/whale.building).
   * Live leaves this unset; null growth+trend while ready ⇒ BUILDING_HISTORY.
   */
  historyBuilding?: boolean;
}

const KIND_PRIORITY: Record<EarlySignalKindId, number> = {
  structure_building: 1,
  concentration_rising: 2,
  whale_distribution_alert: 3,
  holder_momentum: 4,
  distribution_improving: 5,
  new_token_traction: 6,
};

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

function kindPriority(id: EarlySignalKindId): number {
  return KIND_PRIORITY[id] ?? 99;
}

function sortKinds(kinds: EarlySignalKind[]): EarlySignalKind[] {
  return [...kinds].sort(
    (a, b) => kindPriority(a.id) - kindPriority(b.id),
  );
}

function isDistribSellEvent(ev: WhaleActivityEvent): boolean {
  return ev.kind === "confirmed_sell" || ev.kind === "distribution";
}

function hasSignificantPositiveGrowth(
  growth: LiveHolderGrowthSummary | null | undefined,
): boolean {
  return (
    isLiveHolderGrowthSignificant(growth) &&
    growth != null &&
    growth.absolute > 0 &&
    growth.percent > 0
  );
}

function hasSignificantNegativeGrowth(
  growth: LiveHolderGrowthSummary | null | undefined,
): boolean {
  return (
    isLiveHolderGrowthSignificant(growth) &&
    growth != null &&
    growth.absolute < 0 &&
    growth.percent < 0
  );
}

function concentrationImproving(
  trend: LiveConcentrationTrendSummary | null | undefined,
): { ok: boolean; which: "largest" | "top10" | null; deltaPp: number | null } {
  if (!trend?.available) {
    return { ok: false, which: null, deltaPp: null };
  }
  const largestOk =
    trend.largestTrend === "decreasing" &&
    finite(trend.largestDeltaPp) &&
    Math.abs(trend.largestDeltaPp) >= EARLY_CONCENTRATION_PP;
  const top10Ok =
    trend.top10Trend === "decreasing" &&
    finite(trend.top10DeltaPp) &&
    Math.abs(trend.top10DeltaPp) >= EARLY_CONCENTRATION_PP;
  if (largestOk) {
    return { ok: true, which: "largest", deltaPp: trend.largestDeltaPp };
  }
  if (top10Ok) {
    return { ok: true, which: "top10", deltaPp: trend.top10DeltaPp };
  }
  return { ok: false, which: null, deltaPp: null };
}

function concentrationRising(
  trend: LiveConcentrationTrendSummary | null | undefined,
): { ok: boolean; which: "largest" | "top10" | null; deltaPp: number | null } {
  if (!trend?.available) {
    return { ok: false, which: null, deltaPp: null };
  }
  const largestOk =
    trend.largestTrend === "increasing" &&
    finite(trend.largestDeltaPp) &&
    Math.abs(trend.largestDeltaPp) >= EARLY_CONCENTRATION_PP;
  const top10Ok =
    trend.top10Trend === "increasing" &&
    finite(trend.top10DeltaPp) &&
    Math.abs(trend.top10DeltaPp) >= EARLY_CONCENTRATION_PP;
  if (largestOk) {
    return { ok: true, which: "largest", deltaPp: trend.largestDeltaPp };
  }
  if (top10Ok) {
    return { ok: true, which: "top10", deltaPp: trend.top10DeltaPp };
  }
  return { ok: false, which: null, deltaPp: null };
}

function tokenAgeMs(token: TokenAsset, now: number): number | null {
  if (token.listedAt != null && Number.isFinite(token.listedAt)) {
    return Math.max(0, now - token.listedAt);
  }
  return null;
}

function compositeLevel(signals: EarlySignalKind[]): EarlySignalLevel {
  if (!signals.length) return "none";
  if (signals.some((s) => s.id === "structure_building")) return "strong";
  const positives = signals.filter((s) => s.tone === "positive");
  if (positives.length >= 2) return "building";
  if (
    positives.some(
      (s) =>
        s.id === "holder_momentum" ||
        s.id === "distribution_improving" ||
        s.id === "new_token_traction",
    )
  ) {
    return "building";
  }
  return "early";
}

function emptyResult(
  extra?: Partial<EarlySignalResult>,
): EarlySignalResult {
  return {
    maturity: "INSUFFICIENT_DATA",
    signals: [],
    livePrimary: null,
    liveCaution: null,
    detailSignals: [],
    suppressed: false,
    suppressReason: null,
    enrichmentReady: false,
    level: "none",
    label: null,
    confirmations: [],
    ...extra,
  };
}

function present(
  signals: EarlySignalKind[],
  base: Omit<
    EarlySignalResult,
    | "signals"
    | "livePrimary"
    | "liveCaution"
    | "detailSignals"
    | "level"
    | "label"
    | "confirmations"
    | "maturity"
  > & { maturity?: EarlySignalsMaturity },
): EarlySignalResult {
  const sorted = sortKinds(signals);
  const livePrimary = sorted[0] ?? null;
  let liveCaution: EarlySignalKind | null = null;
  if (livePrimary && livePrimary.tone === "positive") {
    liveCaution =
      sorted.find((s) => s.tone === "caution" && s.id !== livePrimary.id) ??
      null;
  }
  const detailSignals = sorted.slice(0, 3);
  const level = compositeLevel(sorted);
  const label = livePrimary?.label ?? null;
  const confirmations: EarlySignalConfirmation[] = sorted.map((s) => ({
    id: s.id,
    message: s.explanation,
  }));
  const maturity: EarlySignalsMaturity =
    base.maturity ??
    (sorted.length > 0 ? "ACTIVE" : "NONE");

  return {
    ...base,
    maturity,
    signals: sorted,
    livePrimary,
    liveCaution,
    detailSignals,
    level,
    label,
    confirmations,
  };
}

/**
 * Deterministic Early Signals from existing LIVE / Detail inputs.
 */
export function assessEarlySignal(
  token: TokenAsset,
  enrichment?: DiscoveryEnrichment | null,
  nowOrOptions: number | AssessEarlySignalsOptions = Date.now(),
): EarlySignalResult {
  const options: AssessEarlySignalsOptions =
    typeof nowOrOptions === "number"
      ? { now: nowOrOptions }
      : nowOrOptions ?? {};
  const now = options.now ?? Date.now();

  if (!token.mint || !token.selectable) {
    return emptyResult({ maturity: "INSUFFICIENT_DATA" });
  }

  const enrichmentReady = enrichment?.status === "ready";
  const growth = enrichment?.holderGrowth ?? null;
  const trend = enrichment?.concentrationTrend ?? null;

  if (!enrichment || enrichment.status === "idle" || enrichment.status === "loading") {
    return emptyResult({
      maturity: "INSUFFICIENT_DATA",
      enrichmentReady: false,
    });
  }

  if (enrichment.status === "unavailable") {
    return emptyResult({
      maturity: "INSUFFICIENT_DATA",
      enrichmentReady: false,
    });
  }

  // Ready enrichment but no usable growth/trend yet → history still building.
  const historyBuilding =
    options.historyBuilding === true ||
    (growth == null && trend == null);

  const positiveGrowth = hasSignificantPositiveGrowth(growth);
  const negativeGrowth = hasSignificantNegativeGrowth(growth);
  const improving = concentrationImproving(trend);
  const rising = concentrationRising(trend);

  const raw: EarlySignalKind[] = [];

  // A) structure_building
  if (positiveGrowth && improving.ok) {
    raw.push({
      id: "structure_building",
      label: "Structure Building",
      tone: "positive",
      explanation:
        "Holder base is growing while ownership concentration is decreasing.",
    });
  }

  // D) concentration_rising (caution) — collect before positives for clarity
  if (rising.ok) {
    raw.push({
      id: "concentration_rising",
      label: "Concentration Rising",
      tone: "caution",
      explanation:
        "Ownership concentration increased meaningfully over the current observation window.",
    });
  }

  // Detail-only whale distribution
  if (options.includeWhale) {
    const whale = options.whaleActivity;
    if (whale?.status === "ready" && whale.events.length) {
      const hit = whale.events.some(
        (ev) =>
          isDistribSellEvent(ev) && (ev.major === true || ev.riskRelevant === true),
      );
      if (hit) {
        raw.push({
          id: "whale_distribution_alert",
          label: "Large-holder distribution",
          tone: "caution",
          explanation:
            "Confirmed significant distribution was observed from a large holder.",
        });
      }
    }
  }

  // B) holder_momentum — skip positive when folded into structure_building
  if (positiveGrowth && !improving.ok) {
    raw.push({
      id: "holder_momentum",
      label: "Holder Momentum",
      tone: "positive",
      explanation:
        "Holder count increased meaningfully over the current observation window.",
    });
  } else if (negativeGrowth) {
    raw.push({
      id: "holder_momentum",
      label: "Holder Decline",
      tone: "caution",
      explanation:
        "Holder count decreased meaningfully over the current observation window.",
    });
  }

  // C) distribution_improving — skip when folded into structure_building
  if (improving.ok && !negativeGrowth && !positiveGrowth) {
    raw.push({
      id: "distribution_improving",
      label: "Distribution Improving",
      tone: "positive",
      explanation:
        "Largest-holder / Top-10 ownership share is decreasing.",
    });
  }

  // E) new_token_traction
  const ageMs = tokenAgeMs(token, now);
  const vol = finite(token.volume24hUsd) ? token.volume24hUsd : null;
  const liq = finite(token.liquidityUsd) ? token.liquidityUsd : null;
  const marketOk =
    (vol != null && vol >= EARLY_TRACTION_VOLUME_USD) ||
    (liq != null && liq >= EARLY_TRACTION_LIQUIDITY_USD);
  if (
    ageMs != null &&
    ageMs < EARLY_NEW_TOKEN_MS &&
    positiveGrowth &&
    marketOk
  ) {
    raw.push({
      id: "new_token_traction",
      label: "New Token Traction",
      tone: "positive",
      explanation:
        "A new token is gaining holders with observable market activity.",
    });
  }

  // --- Suppression: strip positives when structurally dangerous ---
  let suppressed = false;
  let suppressReason: string | null = null;

  const top = enrichment.topHolderPct;
  const top10 = enrichment.top10HolderPct;
  const extremeConc =
    (finite(top) && top >= RISK_TOP_HOLDER_HIGH_PCT) ||
    (finite(top10) && top10 >= RISK_TOP10_HIGH_PCT);
  const highRisk = enrichment.riskLevel === "HIGH";
  const authDanger =
    options.mintAuthorityActive === true ||
    options.freezeAuthorityActive === true;

  if (highRisk || extremeConc || authDanger) {
    suppressed = true;
    if (highRisk) suppressReason = "High structural risk";
    else if (extremeConc) suppressReason = "Extreme holder concentration";
    else suppressReason = "Active mint or freeze authority";
  }

  let signals = raw;
  if (suppressed) {
    signals = raw.filter((s) => s.tone !== "positive");
  }

  // Dedupe: structure_building already excludes component positives above.
  // Also drop new_token_traction when structure_building is the story? Spec
  // priority keeps new_token_traction lower; Live primary will prefer structure.
  // Keep both in Detail list (capped at 3) unless we want stricter dedupe —
  // structure + traction can coexist factually; Live shows one primary.

  if (signals.length > 0) {
    return present(signals, {
      suppressed,
      suppressReason,
      enrichmentReady,
      maturity: "ACTIVE",
    });
  }

  if (historyBuilding) {
    return emptyResult({
      maturity: "BUILDING_HISTORY",
      enrichmentReady,
      suppressed,
      suppressReason,
    });
  }

  return emptyResult({
    maturity: "NONE",
    enrichmentReady,
    suppressed,
    suppressReason,
  });
}

/** Sort key for Early Signals filter: stronger composite, then priority, then volume. */
export function earlySignalRank(
  signal: EarlySignalResult,
  token: TokenAsset,
): number {
  const vol = finite(token.volume24hUsd) ? token.volume24hUsd : 0;
  const levelRank =
    signal.level === "strong"
      ? 3
      : signal.level === "building"
        ? 2
        : signal.level === "early"
          ? 1
          : 0;
  const primaryBoost = signal.livePrimary
    ? (7 - kindPriority(signal.livePrimary.id)) * 1_000
    : 0;
  return (
    levelRank * 1_000_000 +
    primaryBoost +
    signal.signals.length * 10_000 +
    Math.min(vol, 9_999_999) / 1000
  );
}

export function hasEarlySignal(signal: EarlySignalResult): boolean {
  return signal.maturity === "ACTIVE" && signal.signals.length > 0;
}

/** Convenience: Live presentation pair. */
export function liveEarlyBadges(signal: EarlySignalResult): {
  primary: EarlySignalKind | null;
  caution: EarlySignalKind | null;
} {
  return { primary: signal.livePrimary, caution: signal.liveCaution };
}
