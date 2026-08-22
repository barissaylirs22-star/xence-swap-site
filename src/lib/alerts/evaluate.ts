/**
 * Alerts V1 evaluator — change-based transitions over existing observations.
 * Pure functions. Zero network I/O.
 *
 * Reuses Early Signals + Risk levels + Radar liquidity thresholds.
 * Does NOT recreate or alter those formulas.
 */

import {
  assessEarlySignal,
  type EarlySignalKindId,
  type EarlySignalResult,
} from "@/lib/discovery/earlySignals";
import type { DiscoveryEnrichment } from "@/lib/discovery/filters";
import {
  RADAR_LIQ_MOVE_PCT,
  RADAR_LIQ_MOVE_USD,
  RADAR_PRIOR_MAX_AGE_MS,
  type RadarPriorMetrics,
} from "@/lib/discovery/radarEvents";
import type { RiskLevel, WhaleActivityFacts } from "@/lib/intelligence/types";
import type { TokenAsset } from "@/lib/tokens/types";
import {
  ALERT_COOLDOWN_MS,
  ALERT_PRIORITY,
  type AlertArmMap,
  type AlertArmState,
  type AlertEvent,
  type AlertType,
  type FollowedToken,
} from "./types";
import { getArm, setArm } from "./storage";

export interface AlertObservation {
  mint: string;
  symbol?: string;
  name?: string;
  token?: TokenAsset | null;
  enrichment?: DiscoveryEnrichment | null;
  /** Prefer Detail full risk when provided. */
  riskLevel?: RiskLevel | null;
  /** Precomputed Early result (Detail). Live computes via assessEarlySignal. */
  early?: EarlySignalResult | null;
  liquidityUsd?: number | null;
  prior?: RadarPriorMetrics | null;
  /**
   * When true, LARGE_HOLDER_DISTRIBUTION may be evaluated from early/whale.
   * Live path leaves this false — Detail-only.
   */
  includeWhale?: boolean;
  whaleActivity?: WhaleActivityFacts | null;
}

export interface EvaluateAlertsInput {
  followed: FollowedToken[];
  observations: AlertObservation[];
  arms: AlertArmMap;
  now?: number;
}

export interface EvaluateAlertsResult {
  newEvents: AlertEvent[];
  arms: AlertArmMap;
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

function knownRisk(level: RiskLevel | null | undefined): level is Exclude<
  RiskLevel,
  "UNKNOWN"
> {
  return level === "LOW" || level === "MEDIUM" || level === "HIGH";
}

function earlyHas(
  early: EarlySignalResult | null | undefined,
  id: EarlySignalKindId,
): boolean {
  return Boolean(early?.signals.some((s) => s.id === id));
}

function resolveEarly(obs: AlertObservation, now: number): EarlySignalResult | null {
  if (obs.early) return obs.early;
  if (!obs.token || !obs.enrichment) return null;
  if (obs.enrichment.status !== "ready") return null;
  return assessEarlySignal(obs.token, obs.enrichment, {
    now,
    includeWhale: obs.includeWhale === true,
    whaleActivity: obs.whaleActivity ?? null,
  });
}

function resolveRisk(obs: AlertObservation): RiskLevel | null {
  if (obs.riskLevel != null) return obs.riskLevel;
  return obs.enrichment?.riskLevel ?? null;
}

/** Same semantics as Radar liquidity-move, decline-only for LIQUIDITY_DROP. */
export function assessLiquidityDrop(input: {
  liquidityUsd: number | null | undefined;
  prior: RadarPriorMetrics | null | undefined;
  now: number;
}): { active: boolean; pct: number | null; delta: number | null } {
  const liq = finite(input.liquidityUsd) ? input.liquidityUsd : null;
  const prior = input.prior;
  if (
    !prior ||
    input.now - prior.capturedAt > RADAR_PRIOR_MAX_AGE_MS ||
    !finite(prior.liquidityUsd) ||
    prior.liquidityUsd <= 0 ||
    liq == null
  ) {
    return { active: false, pct: null, delta: null };
  }
  const delta = liq - prior.liquidityUsd;
  const pct = (delta / prior.liquidityUsd) * 100;
  // Spec: delta <= -20% AND absolute decline >= $8000
  const active =
    pct <= -RADAR_LIQ_MOVE_PCT && Math.abs(delta) >= RADAR_LIQ_MOVE_USD;
  return { active, pct, delta };
}

function withinCooldown(arm: AlertArmState, now: number): boolean {
  return (
    arm.lastFiredAt != null && now - arm.lastFiredAt < ALERT_COOLDOWN_MS
  );
}

function makeEvent(input: {
  mint: string;
  symbol?: string;
  name?: string;
  type: AlertType;
  reason: string;
  now: number;
}): AlertEvent {
  return {
    id: `${input.mint}:${input.type}:${input.now}`,
    mint: input.mint,
    symbol: input.symbol,
    name: input.name,
    type: input.type,
    priority: ALERT_PRIORITY[input.type],
    reason: input.reason,
    createdAt: input.now,
    read: false,
  };
}

/**
 * Binary inactive→active transition with first-obs baseline + cooldown.
 * Always updates arm state (baseline/re-arm) even when cooldown suppresses fire.
 */
function transitionBinary(opts: {
  arms: AlertArmMap;
  mint: string;
  type: AlertType;
  activeNow: boolean;
  now: number;
  symbol?: string;
  name?: string;
  reason: string;
  events: AlertEvent[];
}): AlertArmMap {
  let arms = opts.arms;
  const arm = getArm(arms, opts.mint, opts.type);

  if (!arm.baselined) {
    return setArm(arms, opts.mint, opts.type, {
      baselined: true,
      active: opts.activeNow,
      lastFiredAt: arm.lastFiredAt,
      lastRiskLevel: arm.lastRiskLevel ?? null,
    });
  }

  const wasActive = arm.active;
  let lastFiredAt = arm.lastFiredAt;

  if (!wasActive && opts.activeNow) {
    if (!withinCooldown(arm, opts.now)) {
      opts.events.push(
        makeEvent({
          mint: opts.mint,
          symbol: opts.symbol,
          name: opts.name,
          type: opts.type,
          reason: opts.reason,
          now: opts.now,
        }),
      );
      lastFiredAt = opts.now;
    }
  }

  return setArm(arms, opts.mint, opts.type, {
    baselined: true,
    active: opts.activeNow,
    lastFiredAt,
    lastRiskLevel: arm.lastRiskLevel ?? null,
  });
}

function transitionRisk(opts: {
  arms: AlertArmMap;
  mint: string;
  risk: RiskLevel;
  now: number;
  symbol?: string;
  name?: string;
  events: AlertEvent[];
}): AlertArmMap {
  let arms = opts.arms;
  const type: AlertType = "RISK_BECAME_HIGH";
  const arm = getArm(arms, opts.mint, type);

  if (!knownRisk(opts.risk)) {
    // Missing / UNKNOWN — do not invent alerts or overwrite known baseline.
    return arms;
  }

  if (!arm.baselined) {
    return setArm(arms, opts.mint, type, {
      baselined: true,
      active: opts.risk === "HIGH",
      lastFiredAt: arm.lastFiredAt,
      lastRiskLevel: opts.risk,
    });
  }

  const prev = arm.lastRiskLevel;
  let lastFiredAt = arm.lastFiredAt;
  const becameHigh =
    knownRisk(prev) && prev !== "HIGH" && opts.risk === "HIGH";

  if (becameHigh && !withinCooldown(arm, opts.now)) {
    opts.events.push(
      makeEvent({
        mint: opts.mint,
        symbol: opts.symbol,
        name: opts.name,
        type,
        reason: `Risk changed from ${prev} to HIGH.`,
        now: opts.now,
      }),
    );
    lastFiredAt = opts.now;
  }

  return setArm(arms, opts.mint, type, {
    baselined: true,
    active: opts.risk === "HIGH",
    lastFiredAt,
    lastRiskLevel: opts.risk,
  });
}

/**
 * Evaluate followed-token observations against persisted arms.
 * Only emits on transitions; first observation baselines only.
 */
export function evaluateAlerts(input: EvaluateAlertsInput): EvaluateAlertsResult {
  const now = input.now ?? Date.now();
  const followedSet = new Set(
    input.followed.map((f) => f.mint).filter(Boolean),
  );
  const followedMeta = new Map(
    input.followed.map((f) => [f.mint, f] as const),
  );

  let arms = { ...input.arms };
  const newEvents: AlertEvent[] = [];

  for (const obs of input.observations) {
    if (!obs.mint || !followedSet.has(obs.mint)) continue;

    const meta = followedMeta.get(obs.mint);
    const symbol = obs.symbol ?? meta?.symbol;
    const name = obs.name ?? meta?.name;

    // A) Risk — known Risk Lite / Full only
    const risk = resolveRisk(obs);
    if (risk != null) {
      arms = transitionRisk({
        arms,
        mint: obs.mint,
        risk,
        now,
        symbol,
        name,
        events: newEvents,
      });
    }

    // Early-derived (B, C, D)
    const early = resolveEarly(obs, now);

    if (early) {
      arms = transitionBinary({
        arms,
        mint: obs.mint,
        type: "CONCENTRATION_RISING",
        activeNow: earlyHas(early, "concentration_rising"),
        now,
        symbol,
        name,
        reason:
          "Holder concentration is rising based on observed holder history.",
        events: newEvents,
      });

      arms = transitionBinary({
        arms,
        mint: obs.mint,
        type: "STRUCTURE_BUILDING",
        activeNow: earlyHas(early, "structure_building"),
        now,
        symbol,
        name,
        reason: "Holder growth and distribution structure are improving.",
        events: newEvents,
      });
    }

    // D) Detail-only whale — only when caller supplies includeWhale
    if (obs.includeWhale === true && early) {
      arms = transitionBinary({
        arms,
        mint: obs.mint,
        type: "LARGE_HOLDER_DISTRIBUTION",
        activeNow: earlyHas(early, "whale_distribution_alert"),
        now,
        symbol,
        name,
        reason:
          "Confirmed significant distribution was observed from a large holder.",
        events: newEvents,
      });
    }

    // E) Liquidity drop — Radar thresholds, decline only
    const liqObs =
      obs.liquidityUsd ??
      (finite(obs.token?.liquidityUsd) ? obs.token!.liquidityUsd : null);
    if (obs.prior != null || liqObs != null) {
      const drop = assessLiquidityDrop({
        liquidityUsd: liqObs,
        prior: obs.prior,
        now,
      });
      // Only advance liquidity arm when we have a comparable prior window
      // OR already baselined (so clear can re-arm). Skip inventing from null prior.
      const arm = getArm(arms, obs.mint, "LIQUIDITY_DROP");
      const comparable =
        drop.pct != null ||
        (obs.prior != null &&
          finite(obs.prior.liquidityUsd) &&
          now - obs.prior.capturedAt <= RADAR_PRIOR_MAX_AGE_MS);

      if (comparable || arm.baselined) {
        const pctLabel =
          drop.pct != null ? Math.abs(Math.round(drop.pct)) : null;
        arms = transitionBinary({
          arms,
          mint: obs.mint,
          type: "LIQUIDITY_DROP",
          activeNow: drop.active,
          now,
          symbol,
          name,
          reason:
            pctLabel != null
              ? `Liquidity decreased ${pctLabel}% in the observed window.`
              : "Liquidity decreased materially in the observed window.",
          events: newEvents,
        });
      }
    }
  }

  return { newEvents, arms };
}
