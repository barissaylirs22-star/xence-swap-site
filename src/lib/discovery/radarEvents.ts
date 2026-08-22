/**
 * AXIOM RADAR V1 — deterministic event/change feed over observed tokens.
 *
 * NOT a ranked token list. NOT AXM Score. NOT Risk. NOT Early Signals rewrite.
 * Pure functions over TokenAsset + DiscoveryEnrichment (+ optional session priors).
 * Zero network I/O inside this module.
 *
 * Never invents score/risk history or profitable/"verified smart money" claims.
 */

import type { TokenAsset } from "@/lib/tokens/types";
import type { RiskLevel } from "@/lib/intelligence/types";
import {
  RISK_TOP10_HIGH_PCT,
  RISK_TOP_HOLDER_HIGH_PCT,
  assessVolumeLiquidityMismatch,
} from "@/lib/intelligence/risk";
import {
  assessEarlySignal,
  EARLY_SPIKE_PCT,
  EARLY_VOLUME_ACTIVE_USD,
  hasEarlySignal,
  type EarlySignalResult,
} from "./earlySignals";
import type { DiscoveryEnrichment } from "./filters";
import {
  formatLiveHolderGrowthElapsed,
  isLiveHolderGrowthSignificant,
} from "./liveHolderGrowth";
import type { LiveConcentrationTrendSummary } from "./liveConcentrationTrend";
import { deriveMovementReason } from "./movementReason";

export type RadarEventType =
  | "HOLDER_ACCELERATION"
  | "DISTRIBUTION_IMPROVING"
  | "CONCENTRATION_RISING"
  | "VOLUME_ACCELERATION"
  | "LIQUIDITY_MOVE"
  | "MOMENTUM_SHIFT"
  | "EARLY_SIGNAL"
  | "MULTI_SIGNAL";

export type RadarDirection = "positive" | "caution" | "neutral";
export type RadarSeverity = "critical" | "high" | "watch" | "info";

export interface RadarSupportingMetric {
  label: string;
  value: string;
}

export interface RadarEvent {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  type: RadarEventType;
  title: string;
  reason: string;
  direction: RadarDirection;
  severity: RadarSeverity;
  /** Observation window label when known (e.g. "1h", "5m", "session"). */
  window: string | null;
  metrics: RadarSupportingMetric[];
  /** Epoch ms used for freshness sorting when genuinely available. */
  observedAt: number;
  /** Dedup key: mint + type + window/level. */
  dedupeKey: string;
  evidenceScore: number;
  /**
   * Optional secondary caution folded from the same mint.
   * Null when no materially useful caution accompanies the primary reason.
   */
  secondaryCaution: string | null;
  /** Context-only Risk Lite level when already known — never ranks alone. */
  riskLevel: RiskLevel | null;
}

/** Prior Dex snapshot for session-local liquidity/volume comparisons only. */
export interface RadarPriorMetrics {
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  capturedAt: number;
}

export interface DeriveRadarEventsOptions {
  /** Session-local priors — never treated as durable Axiom history. */
  priorByMint?: Map<string, RadarPriorMetrics> | null;
  /** Soft cap on returned events. */
  maxEvents?: number;
  now?: number;
}

/** Align with server HOLDERS_RAPID_GROWTH_PCT — Radar prefers clearer acceleration. */
export const RADAR_HOLDER_ACCEL_PCT = 10;

/** Stricter than server 1.0pp material floor — fewer noisy concentration events. */
export const RADAR_CONCENTRATION_PP = 2;

/** Session liquidity move: relative change. */
export const RADAR_LIQ_MOVE_PCT = 20;
/** Session liquidity move: absolute USD floor. */
export const RADAR_LIQ_MOVE_USD = 8_000;
/** Priors older than this are ignored (not durable history). */
export const RADAR_PRIOR_MAX_AGE_MS = 12 * 60_000;

export const RADAR_VOL_HIGH_USD = 100_000;
export const RADAR_VOL_WITH_MOMENTUM_USD = 25_000;
export const RADAR_MOMENTUM_5M_PCT = 8;
export const RADAR_MOMENTUM_1H_PCT = 15;

/** Hard max Radar token cards — never pad to fill. */
export const RADAR_MAX_EVENTS_DEFAULT = 3;

/**
 * Primary-reason priority (lower = stronger).
 * Structural caution beats multi-signal beats structure beats market noise.
 */
export function radarPrimaryPriority(type: RadarEventType): number {
  switch (type) {
    case "CONCENTRATION_RISING":
      return 1;
    case "MULTI_SIGNAL":
      return 2;
    case "HOLDER_ACCELERATION":
    case "EARLY_SIGNAL":
      return 3;
    case "DISTRIBUTION_IMPROVING":
      return 4;
    case "LIQUIDITY_MOVE":
      return 5;
    case "VOLUME_ACCELERATION":
      return 6;
    case "MOMENTUM_SHIFT":
      return 7;
    default:
      return 99;
  }
}

/** Risk HIGH or extreme concentration — positives suppressed; caution may survive. */
export function isRadarPositiveSuppressed(
  enrichment: DiscoveryEnrichment | undefined,
): boolean {
  if (!enrichment) return false;
  if (enrichment.riskLevel === "HIGH") return true;
  if (
    finite(enrichment.topHolderPct) &&
    enrichment.topHolderPct >= RISK_TOP_HOLDER_HIGH_PCT
  ) {
    return true;
  }
  if (
    finite(enrichment.top10HolderPct) &&
    enrichment.top10HolderPct >= RISK_TOP10_HIGH_PCT
  ) {
    return true;
  }
  return false;
}

/** Extreme vol/liq mismatch — do not promote generic positive volume/momentum. */
export function hasExtremeVolLiqMismatch(token: TokenAsset): boolean {
  const mismatch = assessVolumeLiquidityMismatch(
    token.liquidityUsd,
    token.volume24hUsd,
  );
  return Boolean(mismatch?.strong);
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

function severityRank(s: RadarSeverity): number {
  if (s === "critical") return 4;
  if (s === "high") return 3;
  if (s === "watch") return 2;
  return 1;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function formatPct(n: number, digits = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function formatPp(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}pp`;
}

function trendWindow(trend: LiveConcentrationTrendSummary): string {
  return trend.preferredWindow ?? "history";
}

type Candidate = Omit<RadarEvent, "id"> & { type: RadarEventType };

function candidate(
  partial: Omit<Candidate, "id" | "dedupeKey" | "secondaryCaution" | "riskLevel"> & {
    dedupeKey?: string;
    secondaryCaution?: string | null;
    riskLevel?: RiskLevel | null;
  },
): Candidate {
  const dedupeKey =
    partial.dedupeKey ??
    `${partial.mint}:${partial.type}:${partial.window ?? "na"}`;
  return {
    ...partial,
    dedupeKey,
    secondaryCaution: partial.secondaryCaution ?? null,
    riskLevel: partial.riskLevel ?? null,
  };
}

function earlyCandidates(
  token: TokenAsset,
  enrichment: DiscoveryEnrichment | undefined,
  now: number,
): Candidate[] {
  const early = assessEarlySignal(token, enrichment, now);
  if (!hasEarlySignal(early)) return [];

  const primary = early.livePrimary;
  const level = early.level;
  const severity: RadarSeverity =
    primary?.tone === "caution"
      ? "high"
      : level === "strong"
        ? "high"
        : level === "building"
          ? "watch"
          : "info";
  const reasonParts = early.signals
    .slice(0, 3)
    .map((s) => s.explanation);

  return [
    candidate({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      type: "EARLY_SIGNAL",
      title: `Early signal · ${primary?.label ?? early.label ?? level.toUpperCase()}`,
      reason: reasonParts.length
        ? reasonParts.join(" · ")
        : "Observable early change cue",
      direction: primary?.tone === "caution" ? "caution" : "positive",
      severity,
      window: "live",
      metrics: [
        { label: "Signal", value: primary?.label ?? early.label ?? level },
        { label: "Count", value: String(early.signals.length) },
      ],
      observedAt: now,
      evidenceScore: early.signals.length * 12,
      dedupeKey: `${token.mint}:EARLY_SIGNAL:${primary?.id ?? level}`,
    }),
  ];
}

function growthCandidates(
  token: TokenAsset,
  enrichment: DiscoveryEnrichment | undefined,
  now: number,
): Candidate[] {
  if (!enrichment || enrichment.status !== "ready") return [];
  const g = enrichment.holderGrowth;
  if (!isLiveHolderGrowthSignificant(g) || !g) return [];
  if (!(g.absolute > 0 && g.percent >= RADAR_HOLDER_ACCEL_PCT)) return [];

  const window = formatLiveHolderGrowthElapsed(g.actualElapsedMs);
  return [
    candidate({
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      type: "HOLDER_ACCELERATION",
      title: "Holder acceleration",
      reason: `Holder count rising ${formatPct(g.percent)} (${g.fromCount.toLocaleString("en-US")} → ${g.toCount.toLocaleString("en-US")})`,
      direction: "positive",
      severity: g.percent >= 20 ? "high" : "watch",
      window,
      metrics: [
        { label: "Δ holders", value: `+${Math.round(g.absolute)}` },
        { label: "Δ %", value: formatPct(g.percent) },
        { label: "Elapsed", value: window },
      ],
      observedAt: g.toAt || now,
      evidenceScore: Math.min(100, Math.abs(g.percent) + Math.abs(g.absolute) / 10),
      dedupeKey: `${token.mint}:HOLDER_ACCELERATION:${g.window ?? window}`,
    }),
  ];
}

function concentrationCandidates(
  token: TokenAsset,
  enrichment: DiscoveryEnrichment | undefined,
  now: number,
): Candidate[] {
  const trend = enrichment?.concentrationTrend;
  if (!trend?.available) return [];

  const out: Candidate[] = [];
  const win = trendWindow(trend);
  const observedAt = trend.comparedAt ?? now;

  const largestUp =
    trend.largestTrend === "increasing" &&
    finite(trend.largestDeltaPp) &&
    Math.abs(trend.largestDeltaPp) >= RADAR_CONCENTRATION_PP;
  const top10Up =
    trend.top10Trend === "increasing" &&
    finite(trend.top10DeltaPp) &&
    Math.abs(trend.top10DeltaPp) >= RADAR_CONCENTRATION_PP;

  if (largestUp || top10Up) {
    const delta = largestUp
      ? trend.largestDeltaPp!
      : trend.top10DeltaPp!;
    const which = largestUp ? "Largest holder" : "Top 10";
    out.push(
      candidate({
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        type: "CONCENTRATION_RISING",
        title: "Concentration rising",
        reason: `${which} share ${formatPp(delta)} over ${win}`,
        direction: "caution",
        severity:
          Math.abs(delta) >= 5 ||
          (finite(enrichment?.topHolderPct) &&
            enrichment!.topHolderPct! >= 50)
            ? "critical"
            : "high",
        window: win,
        metrics: [
          { label: which, value: formatPp(delta) },
          { label: "Window", value: win },
        ],
        observedAt,
        evidenceScore: Math.abs(delta) * 10,
        dedupeKey: `${token.mint}:CONCENTRATION_RISING:${win}`,
      }),
    );
  }

  const largestDown =
    trend.largestTrend === "decreasing" &&
    finite(trend.largestDeltaPp) &&
    Math.abs(trend.largestDeltaPp) >= RADAR_CONCENTRATION_PP;
  const top10Down =
    trend.top10Trend === "decreasing" &&
    finite(trend.top10DeltaPp) &&
    Math.abs(trend.top10DeltaPp) >= RADAR_CONCENTRATION_PP;

  if (largestDown || top10Down) {
    // Require holder base not meaningfully declining.
    const g = enrichment?.holderGrowth;
    const holdersFalling =
      isLiveHolderGrowthSignificant(g) && g != null && g.absolute < 0;
    if (!holdersFalling) {
      const delta = top10Down
        ? trend.top10DeltaPp!
        : trend.largestDeltaPp!;
      const which = top10Down ? "Top 10" : "Largest holder";
      out.push(
        candidate({
          mint: token.mint,
          symbol: token.symbol,
          name: token.name,
          type: "DISTRIBUTION_IMPROVING",
          title: "Distribution improving",
          reason: `${which} share ${formatPp(delta)} over ${win} while holder base is stable/growing`,
          direction: "positive",
          severity: "watch",
          window: win,
          metrics: [
            { label: which, value: formatPp(delta) },
            { label: "Window", value: win },
          ],
          observedAt,
          evidenceScore: Math.abs(delta) * 8,
          dedupeKey: `${token.mint}:DISTRIBUTION_IMPROVING:${win}`,
        }),
      );
    }
  }

  return out;
}

function marketCandidates(
  token: TokenAsset,
  prior: RadarPriorMetrics | undefined,
  now: number,
): Candidate[] {
  const out: Candidate[] = [];
  const vol = finite(token.volume24hUsd) ? token.volume24hUsd : null;
  const liq = finite(token.liquidityUsd) ? token.liquidityUsd : null;
  const ch5 = finite(token.priceChange5mPct) ? token.priceChange5mPct : null;
  const ch1h = finite(token.priceChange1hPct) ? token.priceChange1hPct : null;
  const spike = ch5 != null && Math.abs(ch5) >= EARLY_SPIKE_PCT;

  // Momentum — skip extreme spikes without volume confirmation (noise / FP).
  if (
    ch5 != null &&
    Math.abs(ch5) >= RADAR_MOMENTUM_5M_PCT &&
    Math.abs(ch5) < EARLY_SPIKE_PCT
  ) {
    out.push(
      candidate({
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        type: "MOMENTUM_SHIFT",
        title: "5m momentum shift",
        reason: `Short-window price change ${formatPct(ch5)}`,
        direction: ch5 >= 0 ? "positive" : "caution",
        severity: Math.abs(ch5) >= 20 ? "watch" : "info",
        window: "5m",
        metrics: [{ label: "5m", value: formatPct(ch5) }],
        observedAt: now,
        evidenceScore: Math.abs(ch5),
        dedupeKey: `${token.mint}:MOMENTUM_SHIFT:5m`,
      }),
    );
  } else if (
    ch1h != null &&
    Math.abs(ch1h) >= RADAR_MOMENTUM_1H_PCT &&
    !(spike && (vol == null || vol < EARLY_VOLUME_ACTIVE_USD))
  ) {
    out.push(
      candidate({
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        type: "MOMENTUM_SHIFT",
        title: "1h momentum shift",
        reason: `Hourly price change ${formatPct(ch1h)}`,
        direction: ch1h >= 0 ? "positive" : "caution",
        severity: "info",
        window: "1h",
        metrics: [{ label: "1h", value: formatPct(ch1h) }],
        observedAt: now,
        evidenceScore: Math.abs(ch1h) * 0.6,
        dedupeKey: `${token.mint}:MOMENTUM_SHIFT:1h`,
      }),
    );
  }

  const move = deriveMovementReason(token, now);
  if (
    move &&
    (move.id === "volume_momentum" || move.id === "high_volume") &&
    vol != null &&
    vol >= RADAR_VOL_WITH_MOMENTUM_USD
  ) {
    out.push(
      candidate({
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        type: "VOLUME_ACCELERATION",
        title:
          move.id === "volume_momentum"
            ? "Volume + momentum"
            : "Elevated volume",
        reason:
          move.id === "volume_momentum"
            ? `Active volume ${formatUsd(vol)} with short-window momentum`
            : `24h volume ${formatUsd(vol)}`,
        direction: "positive",
        severity: vol >= RADAR_VOL_HIGH_USD ? "high" : "watch",
        window: "24h",
        metrics: [
          { label: "24h vol", value: formatUsd(vol) },
          ...(liq != null ? [{ label: "Liq", value: formatUsd(liq) }] : []),
        ],
        observedAt: now,
        evidenceScore: Math.min(120, vol / 1000),
        dedupeKey: `${token.mint}:VOLUME_ACCELERATION:24h`,
      }),
    );
  }

  // Liquidity move — only with fresh session prior (never invent history).
  if (
    prior &&
    now - prior.capturedAt <= RADAR_PRIOR_MAX_AGE_MS &&
    finite(prior.liquidityUsd) &&
    prior.liquidityUsd > 0 &&
    liq != null
  ) {
    const delta = liq - prior.liquidityUsd;
    const pct = (delta / prior.liquidityUsd) * 100;
    if (
      Math.abs(pct) >= RADAR_LIQ_MOVE_PCT &&
      Math.abs(delta) >= RADAR_LIQ_MOVE_USD
    ) {
      out.push(
        candidate({
          mint: token.mint,
          symbol: token.symbol,
          name: token.name,
          type: "LIQUIDITY_MOVE",
          title: delta > 0 ? "Liquidity expanding" : "Liquidity contracting",
          reason: `Session-observed liquidity ${formatPct(pct)} (${formatUsd(prior.liquidityUsd)} → ${formatUsd(liq)})`,
          direction: delta > 0 ? "positive" : "caution",
          severity: Math.abs(pct) >= 40 ? "high" : "watch",
          window: "session",
          metrics: [
            { label: "Δ liq", value: formatUsd(delta) },
            { label: "Δ %", value: formatPct(pct) },
          ],
          observedAt: now,
          evidenceScore: Math.min(100, Math.abs(pct)),
          dedupeKey: `${token.mint}:LIQUIDITY_MOVE:session`,
        }),
      );
    }
  }

  return out;
}

function mergeMulti(
  token: TokenAsset,
  parts: Candidate[],
  now: number,
): Candidate {
  const types = [...new Set(parts.map((p) => p.type))];
  const severity = parts.reduce<RadarSeverity>((best, p) => {
    return severityRank(p.severity) > severityRank(best) ? p.severity : best;
  }, "info");
  const hasCaution = parts.some((p) => p.direction === "caution");
  const allPositive = parts.every((p) => p.direction === "positive");

  return candidate({
    mint: token.mint,
    symbol: token.symbol,
    name: token.name,
    type: "MULTI_SIGNAL",
    title: "Multiple signals",
    reason: parts.map((p) => p.title).join(" · "),
    direction: hasCaution ? "caution" : allPositive ? "positive" : "neutral",
    severity: severityRank(severity) >= 3 ? severity : "high",
    window: "live",
    metrics: [
      { label: "Signals", value: String(types.length) },
      ...parts.slice(0, 3).flatMap((p) => p.metrics.slice(0, 1)),
    ],
    observedAt: Math.max(...parts.map((p) => p.observedAt), now),
    evidenceScore:
      parts.reduce((s, p) => s + p.evidenceScore, 0) + types.length * 15,
    dedupeKey: `${token.mint}:MULTI_SIGNAL:${types.sort().join("+")}`,
  });
}

/**
 * Deduplicate by dedupeKey (keep higher severity / evidence).
 */
export function dedupeRadarEvents(events: RadarEvent[]): RadarEvent[] {
  const best = new Map<string, RadarEvent>();
  for (const ev of events) {
    const prev = best.get(ev.dedupeKey);
    if (!prev) {
      best.set(ev.dedupeKey, ev);
      continue;
    }
    const better =
      severityRank(ev.severity) > severityRank(prev.severity) ||
      (severityRank(ev.severity) === severityRank(prev.severity) &&
        ev.evidenceScore > prev.evidenceScore);
    if (better) best.set(ev.dedupeKey, ev);
  }
  return [...best.values()];
}

/**
 * Sort: severity → freshness → evidence. Never by price gain alone.
 * Token shortlist also applies primary-type priority (structural > market noise).
 */
export function sortRadarEvents(
  events: RadarEvent[],
  now = Date.now(),
): RadarEvent[] {
  return [...events].sort((a, b) => {
    const pr = radarPrimaryPriority(a.type) - radarPrimaryPriority(b.type);
    if (pr !== 0) return pr;
    const sr = severityRank(b.severity) - severityRank(a.severity);
    if (sr !== 0) return sr;
    const ageA = Math.max(0, now - a.observedAt);
    const ageB = Math.max(0, now - b.observedAt);
    if (ageA !== ageB) return ageA - ageB;
    return b.evidenceScore - a.evidenceScore;
  });
}

function pickPrimary(parts: Candidate[]): Candidate {
  return [...parts].sort((a, b) => {
    const pr = radarPrimaryPriority(a.type) - radarPrimaryPriority(b.type);
    if (pr !== 0) return pr;
    const sr = severityRank(b.severity) - severityRank(a.severity);
    if (sr !== 0) return sr;
    return b.evidenceScore - a.evidenceScore;
  })[0];
}

function cautionLabel(c: Candidate): string {
  if (c.type === "CONCENTRATION_RISING") return "Concentration rising";
  if (c.direction === "caution" && c.type === "LIQUIDITY_MOVE") {
    return "Liquidity contracting";
  }
  if (c.direction === "caution" && c.type === "MOMENTUM_SHIFT") {
    return "Short-window downside move";
  }
  if (c.direction === "caution") return c.title;
  return c.title;
}

/**
 * Fold mint events into one primary reason + optional secondary caution.
 */
export function foldMintCandidates(
  token: TokenAsset,
  parts: Candidate[],
  enrichment: DiscoveryEnrichment | undefined,
  now: number,
): Candidate | null {
  if (parts.length === 0) return null;

  const suppressed = isRadarPositiveSuppressed(enrichment);
  const extremeVolLiq = hasExtremeVolLiqMismatch(token);

  let usable = parts.filter((p) => {
    if (suppressed && p.direction === "positive") return false;
    if (
      extremeVolLiq &&
      p.direction === "positive" &&
      (p.type === "VOLUME_ACCELERATION" || p.type === "MOMENTUM_SHIFT")
    ) {
      return false;
    }
    return true;
  });

  if (usable.length === 0) return null;

  // Multi-family → MULTI_SIGNAL primary when still meaningful after filters.
  const families = new Set(
    usable.map((c) => {
      if (c.type === "EARLY_SIGNAL") return "early";
      if (
        c.type === "HOLDER_ACCELERATION" ||
        c.type === "DISTRIBUTION_IMPROVING" ||
        c.type === "CONCENTRATION_RISING"
      ) {
        return "structure";
      }
      return "market";
    }),
  );

  let primary: Candidate;
  let remainder: Candidate[];

  // Prefer explicit structural caution as primary (priority 1 > MULTI_SIGNAL).
  const structuralCaution = usable.find((p) => p.type === "CONCENTRATION_RISING");
  if (structuralCaution) {
    primary = structuralCaution;
    remainder = usable.filter((p) => p.dedupeKey !== primary.dedupeKey);
  } else if (families.size >= 2 && usable.length >= 2) {
    primary = mergeMulti(token, usable, now);
    remainder = usable;
  } else {
    primary = pickPrimary(usable);
    remainder = usable.filter((p) => p.dedupeKey !== primary.dedupeKey);
  }

  // Pure market noise alone is allowed only as weak fallback (demoted in sort).
  const cautionSource = remainder.find((p) => {
    if (p.type === "CONCENTRATION_RISING") return true;
    return p.direction === "caution";
  });

  let secondaryCaution: string | null = null;
  if (
    cautionSource &&
    cautionSource.type !== primary.type &&
    !(
      primary.type === "MULTI_SIGNAL" &&
      primary.dedupeKey.includes(cautionSource.type)
    )
  ) {
    const earlyDupesConcentration =
      primary.type === "CONCENTRATION_RISING" &&
      cautionSource.type === "EARLY_SIGNAL" &&
      /concentration/i.test(`${cautionSource.title} ${cautionSource.reason}`);
    if (!earlyDupesConcentration) {
      secondaryCaution = cautionLabel(cautionSource);
    }
  } else if (suppressed && enrichment?.riskLevel === "HIGH") {
    if (primary.direction === "caution" || primary.type === "MULTI_SIGNAL") {
      secondaryCaution = "HIGH structural risk";
    }
  } else if (
    extremeVolLiq &&
    primary.direction === "positive" &&
    primary.type !== "VOLUME_ACCELERATION"
  ) {
    secondaryCaution = "Volume/liquidity imbalance";
  }

  return {
    ...primary,
    secondaryCaution,
    riskLevel: enrichment?.riskLevel ?? null,
  };
}

/**
 * Derive Radar shortlist for the observed discovery universe.
 * Max 3 token cards; one card per mint; empty is valid; never pads.
 */
export function deriveRadarEvents(
  tokens: TokenAsset[],
  enrichment: Map<string, DiscoveryEnrichment>,
  options?: DeriveRadarEventsOptions,
): RadarEvent[] {
  const now = options?.now ?? Date.now();
  const maxEvents = options?.maxEvents ?? RADAR_MAX_EVENTS_DEFAULT;
  const priorByMint = options?.priorByMint ?? null;

  const folded: Candidate[] = [];

  for (const token of tokens) {
    if (!token.mint || !token.selectable) continue;
    const e = enrichment.get(token.mint);
    const prior = priorByMint?.get(token.mint);

    const cands: Candidate[] = [
      ...growthCandidates(token, e, now),
      ...concentrationCandidates(token, e, now),
      ...marketCandidates(token, prior, now),
      ...earlyCandidates(token, e, now),
    ];

    if (cands.length === 0) continue;

    const card = foldMintCandidates(token, cands, e, now);
    if (card) folded.push(card);
  }

  // Token-centric: one card per mint (fold already enforces; defend).
  const byMint = new Map<string, Candidate>();
  for (const c of folded) {
    const prev = byMint.get(c.mint);
    if (!prev) {
      byMint.set(c.mint, c);
      continue;
    }
    const better =
      radarPrimaryPriority(c.type) < radarPrimaryPriority(prev.type) ||
      (radarPrimaryPriority(c.type) === radarPrimaryPriority(prev.type) &&
        (severityRank(c.severity) > severityRank(prev.severity) ||
          (severityRank(c.severity) === severityRank(prev.severity) &&
            c.evidenceScore > prev.evidenceScore)));
    if (better) byMint.set(c.mint, c);
  }

  const flat: RadarEvent[] = [...byMint.values()].map((c) => ({
    ...c,
    id: `${c.mint}:${c.type}`,
    secondaryCaution: c.secondaryCaution ?? null,
    riskLevel: c.riskLevel ?? null,
  }));

  const deduped = dedupeRadarEvents(flat);
  return sortRadarEvents(deduped, now).slice(0, maxEvents);
}

/** Build session prior snapshot from current tokens (caller stores between refreshes). */
export function snapshotRadarPriors(
  tokens: TokenAsset[],
  now = Date.now(),
): Map<string, RadarPriorMetrics> {
  const map = new Map<string, RadarPriorMetrics>();
  for (const t of tokens) {
    if (!t.mint) continue;
    map.set(t.mint, {
      liquidityUsd: finite(t.liquidityUsd) ? t.liquidityUsd : null,
      volume24hUsd: finite(t.volume24hUsd) ? t.volume24hUsd : null,
      capturedAt: now,
    });
  }
  return map;
}

export function radarSeverityLabel(severity: RadarSeverity): string {
  if (severity === "critical") return "CRITICAL";
  if (severity === "high") return "HIGH";
  if (severity === "watch") return "WATCH";
  return "INFO";
}

/** Expose Early result for tests without re-exporting formula internals. */
export function peekEarlyForRadar(
  token: TokenAsset,
  enrichment?: DiscoveryEnrichment | null,
  now = Date.now(),
): EarlySignalResult {
  return assessEarlySignal(token, enrichment, now);
}
