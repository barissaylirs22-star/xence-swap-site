/**
 * Early Signals V1 — LIVE-only, explainable multi-confirmation detector.
 *
 * NOT a price prediction. NOT AXM Score. NOT Risk Analysis.
 * Pure function over TokenAsset + DiscoveryEnrichment already in memory.
 * Zero network I/O.
 *
 * Strength:
 *   EARLY    ≥2 independent confirmations (market-capable while enriching)
 *   BUILDING ≥3 confirmations including ≥1 holder-structure confirmation
 *            (requires enrichment ready)
 *   STRONG   ≥4 confirmations including holder growth + healthy concentration
 *            (requires enrichment ready)
 *
 * Suppression / caps:
 *   - Risk HIGH (when ready) → none
 *   - Extreme concentration (when ready) → none
 *   - Fragile AXM structure when holders known (score < 30) → none
 *   - Extreme 5m spike without ≥2 non-momentum confirms → none
 *   - Single confirmation alone → none
 *   - Missing holders/growth → neutral (never invents positive/negative)
 *   - While enrichment loading/idle → max EARLY (no BUILDING/STRONG flicker)
 */

import type { TokenAsset } from "@/lib/tokens/types";
import {
  isLiveHolderGrowthSignificant,
  type LiveHolderGrowthSummary,
} from "./liveHolderGrowth";
import type { DiscoveryEnrichment } from "./filters";
import { resolveLiveAxiomScore } from "./resolvedAxiomScore";
import {
  RISK_TOP10_HIGH_PCT,
  RISK_TOP10_MEDIUM_PCT,
  RISK_TOP_HOLDER_HIGH_PCT,
  RISK_TOP_HOLDER_MEDIUM_PCT,
} from "@/lib/intelligence/risk";

export type EarlySignalLevel = "none" | "early" | "building" | "strong";

export type EarlySignalConfirmationId =
  | "constructive_momentum"
  | "active_volume"
  | "adequate_liquidity"
  | "fresh_listing"
  | "holders_growing"
  | "concentration_healthy";

export interface EarlySignalConfirmation {
  id: EarlySignalConfirmationId;
  message: string;
}

export interface EarlySignalResult {
  level: EarlySignalLevel;
  /** Short badge label — only when level !== none. */
  label: string | null;
  confirmations: EarlySignalConfirmation[];
  suppressed: boolean;
  suppressReason: string | null;
  /** True when holder enrichment was ready for structure checks. */
  enrichmentReady: boolean;
}

/** Constructive (not spike) short-term move. */
export const EARLY_MOMENTUM_MIN_PCT = 5;
export const EARLY_MOMENTUM_MAX_PCT = 40;
/** Extreme spike — alone never creates a signal. */
export const EARLY_SPIKE_PCT = 80;

export const EARLY_VOLUME_ACTIVE_USD = 25_000;
export const EARLY_VOLUME_RATIO_MIN = 1.5;

export const EARLY_LIQUIDITY_MIN_USD = 5_000;

/** Fresh listing window for “early” context. */
export const EARLY_FRESH_MS = 72 * 60 * 60 * 1000;

/** AXM context gate — fragile structure suppresses when holders known. */
export const EARLY_AXM_MIN_WHEN_HOLDERS = 30;

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

function pickMomentumPct(token: TokenAsset): number | null {
  if (finite(token.priceChange5mPct)) return token.priceChange5mPct;
  if (finite(token.priceChange1hPct)) return token.priceChange1hPct;
  return null;
}

function levelLabel(level: EarlySignalLevel): string | null {
  if (level === "early") return "EARLY";
  if (level === "building") return "BUILDING";
  if (level === "strong") return "STRONG";
  return null;
}

function rankLevel(level: EarlySignalLevel): number {
  if (level === "strong") return 3;
  if (level === "building") return 2;
  if (level === "early") return 1;
  return 0;
}

/**
 * Deterministic Early Signal from existing LIVE row inputs.
 */
export function assessEarlySignal(
  token: TokenAsset,
  enrichment?: DiscoveryEnrichment | null,
  now = Date.now(),
): EarlySignalResult {
  const empty = (
    extra?: Partial<EarlySignalResult>,
  ): EarlySignalResult => ({
    level: "none",
    label: null,
    confirmations: [],
    suppressed: false,
    suppressReason: null,
    enrichmentReady: enrichment?.status === "ready",
    ...extra,
  });

  if (!token.mint || !token.selectable) return empty();

  const enrichmentReady = enrichment?.status === "ready";
  const confirmations: EarlySignalConfirmation[] = [];

  const ch = pickMomentumPct(token);
  const ch5 = finite(token.priceChange5mPct) ? token.priceChange5mPct : null;
  const spike =
    ch5 != null && Math.abs(ch5) >= EARLY_SPIKE_PCT;

  // 1) Constructive momentum (positive, bounded — spikes do not count)
  if (
    ch != null &&
    ch >= EARLY_MOMENTUM_MIN_PCT &&
    ch <= EARLY_MOMENTUM_MAX_PCT
  ) {
    const window = finite(token.priceChange5mPct) ? "5m" : "1h";
    confirmations.push({
      id: "constructive_momentum",
      message: `Constructive ${window} move (+${ch.toFixed(1)}%)`,
    });
  }

  // 2) Active volume
  const vol = finite(token.volume24hUsd) ? token.volume24hUsd : null;
  const liq = finite(token.liquidityUsd) ? token.liquidityUsd : null;
  if (vol != null && vol >= EARLY_VOLUME_ACTIVE_USD) {
    const ratioOk =
      liq != null && liq > 0 ? vol / liq >= EARLY_VOLUME_RATIO_MIN : true;
    if (ratioOk) {
      confirmations.push({
        id: "active_volume",
        message: "Active trading volume",
      });
    }
  }

  // 3) Adequate liquidity (not thin)
  if (liq != null && liq >= EARLY_LIQUIDITY_MIN_USD) {
    confirmations.push({
      id: "adequate_liquidity",
      message: "Adequate liquidity",
    });
  }

  // 4) Fresh listing window
  const ageMs =
    token.listedAt != null && Number.isFinite(token.listedAt)
      ? Math.max(0, now - token.listedAt)
      : null;
  if (
    (ageMs != null && ageMs < EARLY_FRESH_MS) ||
    (token.isFresh === true && ageMs != null && ageMs < EARLY_FRESH_MS)
  ) {
    confirmations.push({
      id: "fresh_listing",
      message: "Still in early listing window",
    });
  }

  // Holder-structure confirmations — only when enrichment ready (never invent)
  let holdersGrowing = false;
  let concentrationHealthy = false;

  if (enrichmentReady) {
    const growth: LiveHolderGrowthSummary | null =
      enrichment?.holderGrowth ?? null;
    if (
      isLiveHolderGrowthSignificant(growth) &&
      growth != null &&
      growth.absolute > 0 &&
      growth.percent > 0
    ) {
      holdersGrowing = true;
      confirmations.push({
        id: "holders_growing",
        message: `Holder count rising (${growth.percent > 0 ? "+" : ""}${growth.percent.toFixed(1)}%)`,
      });
    }

    const top = enrichment?.topHolderPct;
    const top10 = enrichment?.top10HolderPct;
    if (
      finite(top) &&
      finite(top10) &&
      top < RISK_TOP_HOLDER_MEDIUM_PCT &&
      top10 < RISK_TOP10_MEDIUM_PCT
    ) {
      concentrationHealthy = true;
      confirmations.push({
        id: "concentration_healthy",
        message: "Holder concentration not elevated",
      });
    }
  }

  // --- Suppressions (missing data never invents; known danger blocks) ---
  if (enrichmentReady && enrichment?.riskLevel === "HIGH") {
    return empty({
      suppressed: true,
      suppressReason: "High structural risk",
      enrichmentReady,
    });
  }

  if (enrichmentReady) {
    const top = enrichment?.topHolderPct;
    const top10 = enrichment?.top10HolderPct;
    if (
      (finite(top) && top >= RISK_TOP_HOLDER_HIGH_PCT) ||
      (finite(top10) && top10 >= RISK_TOP10_HIGH_PCT)
    ) {
      return empty({
        suppressed: true,
        suppressReason: "Extreme holder concentration",
        enrichmentReady,
      });
    }
  }

  // AXM context only — never a confirmation. Suppress fragile structure
  // when holders are known so Score doesn't silently mint Early Signals.
  if (enrichmentReady) {
    const axm = resolveLiveAxiomScore(token, enrichment, now);
    if (axm && axm.score < EARLY_AXM_MIN_WHEN_HOLDERS) {
      return empty({
        suppressed: true,
        suppressReason: "Fragile Axiom structure score",
        enrichmentReady,
      });
    }
  }

  const nonMomentum = confirmations.filter(
    (c) => c.id !== "constructive_momentum",
  );
  if (spike && nonMomentum.length < 2) {
    return empty({
      suppressed: true,
      suppressReason: "Extreme price spike without confirmations",
      enrichmentReady,
    });
  }

  if (confirmations.length < 2) {
    return empty({ enrichmentReady });
  }

  const structureHit = holdersGrowing || concentrationHealthy;

  let level: EarlySignalLevel = "early";
  if (
    enrichmentReady &&
    confirmations.length >= 4 &&
    holdersGrowing &&
    concentrationHealthy
  ) {
    level = "strong";
  } else if (enrichmentReady && confirmations.length >= 3 && structureHit) {
    level = "building";
  } else if (!enrichmentReady) {
    // Progressive stability: without ready holders, never claim BUILDING/STRONG.
    level = "early";
  } else if (confirmations.length >= 3 && !structureHit) {
    // Market-only cluster while holders ready but no structure confirm → EARLY.
    level = "early";
  }

  return {
    level,
    label: levelLabel(level),
    confirmations,
    suppressed: false,
    suppressReason: null,
    enrichmentReady,
  };
}

/** Sort key: stronger first, then more confirmations, then volume. */
export function earlySignalRank(
  signal: EarlySignalResult,
  token: TokenAsset,
): number {
  const vol = finite(token.volume24hUsd) ? token.volume24hUsd : 0;
  return (
    rankLevel(signal.level) * 1_000_000 +
    signal.confirmations.length * 10_000 +
    Math.min(vol, 9_999_999) / 1000
  );
}

export function hasEarlySignal(signal: EarlySignalResult): boolean {
  return signal.level !== "none";
}
