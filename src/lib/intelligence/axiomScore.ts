/**
 * Axiom Score V2 — explainable 0–100 structural quality score.
 * Not a price prediction. Missing history/whale data → neutral, never fabricated.
 */

import type {
  AxiomDataConfidence,
  AxiomScoreBand,
  AxiomScoreCategory,
  AxiomScoreFactor,
  AxiomScoreResult,
  HolderIntelV2Facts,
  RiskLevel,
  RiskReason,
  TokenIntelligence,
  TokenMarketFacts,
  TokenRiskAssessment,
  TokenSecurityFacts,
  TokenTradingFacts,
  WhaleActivityFacts,
} from "./types";
import {
  CONCENTRATION_MATERIAL_PP,
  HOLDERS_FALLING_ABS,
  HOLDERS_FALLING_PCT,
} from "./holderHistory";
import {
  assessTokenRisk,
  RISK_TOP10_HIGH_PCT,
  RISK_TOP10_MEDIUM_PCT,
  RISK_TOP_HOLDER_HIGH_PCT,
  RISK_TOP_HOLDER_MEDIUM_PCT,
  RISK_VERY_LOW_LIQUIDITY_USD,
  RISK_VERY_NEW_MS,
} from "./risk";
import { WHALE_SUPPLY_MAJOR_PCT } from "./whaleThresholds";

/** Category weights (sum = 100). */
export const AXIOM_SCORE_WEIGHTS = {
  security: 25,
  holders: 25,
  liquidity: 20,
  holderTrend: 15,
  whale: 15,
} as const;

/** Dead zones — tiny moves must not swing the score. */
export const SCORE_DEADZONE = {
  /** Holder growth |%| below this → treat as stable. */
  holderGrowthPct: 2,
  /** Concentration |pp| below this → treat as stable. */
  concentrationPp: 0.5,
  /** Whale USD below this ignored for scoring (already dust-filtered upstream). */
  whaleUsd: 200,
} as const;

export type {
  AxiomDataConfidence,
  AxiomScoreBand,
  AxiomScoreCategory,
  AxiomScoreFactor,
  AxiomScoreResult,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function classifyAxiomScore(score: number): {
  band: AxiomScoreBand;
  label: string;
} {
  if (score >= 85) return { band: "strong_structure", label: "Strong Structure" };
  if (score >= 70) return { band: "healthy", label: "Healthy" };
  if (score >= 50) return { band: "caution", label: "Caution" };
  if (score >= 30) return { band: "high_risk", label: "High Risk" };
  return { band: "extreme_risk", label: "Extreme Risk" };
}

/**
 * Map score → Risk badge. Critical security/concentration overrides force HIGH.
 */
export function mapAxiomScoreToRiskLevel(
  score: number,
  options: {
    reasons: RiskReason[];
    security: TokenSecurityFacts;
  },
): { level: RiskLevel; criticalOverride: boolean; reason: string | null } {
  const { reasons, security } = options;

  const mintActive = security.mintAuthorityActive === true;
  const freezeActive = security.freezeAuthorityActive === true;
  const extremeTop =
    security.topHolderPct != null &&
    security.topHolderPct >= RISK_TOP_HOLDER_HIGH_PCT;
  const extremeTop10 =
    security.top10HolderPct != null &&
    security.top10HolderPct >= RISK_TOP10_HIGH_PCT;

  // Critical overrides — must be visible in risk reasons when triggered.
  if (mintActive && freezeActive) {
    return {
      level: "HIGH",
      criticalOverride: true,
      reason: "Mint and freeze authorities both active",
    };
  }
  if (extremeTop && mintActive) {
    return {
      level: "HIGH",
      criticalOverride: true,
      reason: "Active mint authority with extreme holder concentration",
    };
  }
  if (extremeTop && extremeTop10) {
    return {
      level: "HIGH",
      criticalOverride: true,
      reason: "Extreme largest-holder and top-10 concentration",
    };
  }

  const materialSoft = reasons.some((r) =>
    [
      "holders_falling_rapidly",
      "holders_falling_concentration_rising",
      "largest_holder_share_rising",
      "top10_concentration_rising",
      "large_confirmed_sell_major_holder",
      "major_holder_distribution",
      "no_jupiter_route",
      "high_price_impact",
      "very_low_liquidity",
      "mint_authority_active",
      "freeze_authority_active",
      "high_holder_concentration",
      "high_top10_concentration",
    ].includes(r.code),
  );

  if (score >= 85) {
    return { level: "LOW", criticalOverride: false, reason: null };
  }
  if (score >= 70) {
    return {
      level: materialSoft ? "MEDIUM" : "LOW",
      criticalOverride: false,
      reason: null,
    };
  }
  if (score >= 50) {
    return { level: "MEDIUM", criticalOverride: false, reason: null };
  }
  return { level: "HIGH", criticalOverride: false, reason: null };
}

function scoreSecurity(
  security: TokenSecurityFacts,
  trading: TokenTradingFacts,
  factors: AxiomScoreFactor[],
): AxiomScoreCategory {
  const max = AXIOM_SCORE_WEIGHTS.security;
  let points = 0;
  let known = 0;
  let totalSlots = 0;

  // Mint (10)
  totalSlots += 1;
  if (security.mintAuthorityActive === false) {
    points += 10;
    known += 1;
    factors.push({
      code: "mint_revoked",
      message: "Mint authority revoked",
      tone: "positive",
      weight: 10,
    });
  } else if (security.mintAuthorityActive === true) {
    known += 1;
    factors.push({
      code: "mint_active",
      message: "Mint authority active",
      tone: "warning",
      weight: 12,
    });
  } else {
    points += 5; // neutral half — not treated as revoked
  }

  // Freeze (10)
  totalSlots += 1;
  if (security.freezeAuthorityActive === false) {
    points += 10;
    known += 1;
    factors.push({
      code: "freeze_revoked",
      message: "Freeze authority revoked",
      tone: "positive",
      weight: 10,
    });
  } else if (security.freezeAuthorityActive === true) {
    known += 1;
    factors.push({
      code: "freeze_active",
      message: "Freeze authority active",
      tone: "warning",
      weight: 12,
    });
  } else {
    points += 5;
  }

  // Route / tradability (5)
  totalSlots += 1;
  if (trading.routeAvailable === true) {
    points += 5;
    known += 1;
    factors.push({
      code: "route_ok",
      message: "Jupiter route available",
      tone: "positive",
      weight: 6,
    });
  } else if (trading.routeAvailable === false) {
    known += 1;
    factors.push({
      code: "no_route",
      message: "No Jupiter route",
      tone: "warning",
      weight: 8,
    });
  } else {
    points += 2.5;
  }

  const neutralMissing = known < totalSlots;
  return {
    id: "security",
    label: "Token Control / Security",
    max,
    points: round1(clamp(points, 0, max)),
    neutralMissing,
  };
}

/**
 * Holder distribution.
 * Limitation: largest accounts may include LP / bonding-curve / custody vaults;
 * Axiom does not currently classify program accounts, so concentration is
 * treated as structural ownership signal, not proven “individual whale” identity.
 */
function scoreHolders(
  security: TokenSecurityFacts,
  factors: AxiomScoreFactor[],
): AxiomScoreCategory {
  const max = AXIOM_SCORE_WEIGHTS.holders;
  if (!security.holdersAvailable) {
    return {
      id: "holders",
      label: "Holder Distribution",
      max,
      points: max / 2,
      neutralMissing: true,
    };
  }

  let points = 0;
  const top = security.topHolderPct;
  const top10 = security.top10HolderPct;

  // Largest holder — 12.5 pts
  if (top != null && Number.isFinite(top)) {
    if (top < 10) {
      points += 12.5;
      factors.push({
        code: "low_largest",
        message: `Largest holder ${top.toFixed(1)}%`,
        tone: "positive",
        weight: 8,
      });
    } else if (top < 20) points += 10;
    else if (top < RISK_TOP_HOLDER_MEDIUM_PCT) points += 7;
    else if (top < RISK_TOP_HOLDER_HIGH_PCT) {
      points += 3;
      factors.push({
        code: "elevated_largest",
        message: `Elevated largest holder (${top.toFixed(1)}%)`,
        tone: "warning",
        weight: 9,
      });
    } else {
      points += 0;
      factors.push({
        code: "extreme_largest",
        message: `Extreme largest holder (${top.toFixed(1)}%)`,
        tone: "warning",
        weight: 14,
      });
    }
  } else {
    points += 6.25;
  }

  // Top 10 — 12.5 pts
  if (top10 != null && Number.isFinite(top10)) {
    if (top10 < 30) {
      points += 12.5;
      factors.push({
        code: "low_top10",
        message: `Top 10 holders ${top10.toFixed(1)}%`,
        tone: "positive",
        weight: 7,
      });
    } else if (top10 < 50) points += 10;
    else if (top10 < RISK_TOP10_MEDIUM_PCT) points += 6;
    else if (top10 < RISK_TOP10_HIGH_PCT) {
      points += 3;
      factors.push({
        code: "elevated_top10",
        message: `Elevated top-10 concentration (${top10.toFixed(1)}%)`,
        tone: "warning",
        weight: 9,
      });
    } else {
      points += 0;
      factors.push({
        code: "extreme_top10",
        message: `Extreme top-10 concentration (${top10.toFixed(1)}%)`,
        tone: "warning",
        weight: 14,
      });
    }
  } else {
    points += 6.25;
  }

  // Tiny bonus/penalty for holder count breadth (max ±1 within category clamp)
  const hc = security.holderCount;
  if (hc != null && Number.isFinite(hc)) {
    if (hc >= 5_000) points += 0; // already at structural health via concentration
    else if (hc < 50) {
      points -= 2;
      factors.push({
        code: "few_holders",
        message: `Very low holder count (${hc.toLocaleString("en-US")})`,
        tone: "warning",
        weight: 5,
      });
    }
  }

  return {
    id: "holders",
    label: "Holder Distribution",
    max,
    points: round1(clamp(points, 0, max)),
    neutralMissing: false,
  };
}

function scoreLiquidity(
  market: TokenMarketFacts,
  trading: TokenTradingFacts,
  factors: AxiomScoreFactor[],
): AxiomScoreCategory {
  const max = AXIOM_SCORE_WEIGHTS.liquidity;
  const liq = market.liquidityUsd;
  const mcap = market.marketCapUsd ?? market.fdvUsd;

  if (liq == null || !Number.isFinite(liq)) {
    return {
      id: "liquidity",
      label: "Liquidity / Market Structure",
      max,
      points: max / 2,
      neutralMissing: true,
    };
  }

  let points = 0;

  // Absolute liquidity depth — 12 pts
  if (liq >= 100_000) {
    points += 12;
    factors.push({
      code: "healthy_liq",
      message: "Healthy liquidity",
      tone: "positive",
      weight: 8,
    });
  } else if (liq >= 25_000) points += 10;
  else if (liq >= 5_000) points += 7;
  else if (liq >= RISK_VERY_LOW_LIQUIDITY_USD) {
    points += 4;
    factors.push({
      code: "thin_liq",
      message: `Thin liquidity ($${Math.round(liq).toLocaleString("en-US")})`,
      tone: "warning",
      weight: 8,
    });
  } else {
    points += 1;
    factors.push({
      code: "very_low_liq",
      message: `Very low liquidity ($${Math.round(liq).toLocaleString("en-US")})`,
      tone: "warning",
      weight: 12,
    });
  }

  // Liquidity vs size — 6 pts (do not reward huge mcap alone)
  if (mcap != null && Number.isFinite(mcap) && mcap > 0) {
    const ratio = liq / mcap;
    if (ratio >= 0.12) points += 6;
    else if (ratio >= 0.05) points += 4.5;
    else if (ratio >= 0.02) points += 3;
    else {
      points += 1;
      factors.push({
        code: "thin_vs_mcap",
        message: "Liquidity thin relative to market size",
        tone: "warning",
        weight: 7,
      });
    }
  } else {
    points += 3; // half of ratio slot
  }

  // Price impact — 2 pts
  if (trading.priceImpactLevel === "low") points += 2;
  else if (trading.priceImpactLevel === "moderate") points += 1;
  else if (trading.priceImpactLevel === "elevated") {
    points += 0.5;
    factors.push({
      code: "elevated_impact",
      message: "Elevated estimated price impact",
      tone: "warning",
      weight: 6,
    });
  } else if (trading.priceImpactLevel === "high") {
    points += 0;
    factors.push({
      code: "high_impact",
      message: "High estimated price impact",
      tone: "warning",
      weight: 9,
    });
  } else {
    points += 1;
  }

  // Very new + thin liquidity extra caution (already in risk reasons)
  if (
    market.ageMs != null &&
    market.ageMs < RISK_VERY_NEW_MS &&
    liq < RISK_VERY_LOW_LIQUIDITY_USD
  ) {
    points = Math.max(0, points - 2);
  }

  return {
    id: "liquidity",
    label: "Liquidity / Market Structure",
    max,
    points: round1(clamp(points, 0, max)),
    neutralMissing: false,
  };
}

function pickGrowthDelta(holderIntel: HolderIntelV2Facts | null) {
  if (!holderIntel?.growth.available) return null;
  const deltas = holderIntel.growth.deltas;
  return (
    deltas.find((d) => d.window === "1h") ??
    deltas.find((d) => d.window === "6h") ??
    deltas.find((d) => d.window === "5m") ??
    deltas[0] ??
    null
  );
}

function scoreHolderTrend(
  holderIntel: HolderIntelV2Facts | null,
  factors: AxiomScoreFactor[],
): AxiomScoreCategory {
  const max = AXIOM_SCORE_WEIGHTS.holderTrend;
  const growth = pickGrowthDelta(holderIntel);
  const whale = holderIntel?.whale;

  if (!holderIntel || (!holderIntel.growth.available && !whale?.available)) {
    return {
      id: "holderTrend",
      label: "Holder Trend",
      max,
      points: max / 2,
      neutralMissing: true,
    };
  }

  let points = max / 2; // start neutral, move with evidence

  if (growth) {
    const pct = growth.percent;
    const stableGrowth = Math.abs(pct) < SCORE_DEADZONE.holderGrowthPct;
    if (stableGrowth) {
      points += 1;
      factors.push({
        code: "growth_stable",
        message: "Holder growth stable",
        tone: "positive",
        weight: 3,
      });
    } else if (pct >= 10) {
      points += 4;
      factors.push({
        code: "holders_growing_fast",
        message: `Holder count growing (${growth.window} ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`,
        tone: "positive",
        weight: 8,
      });
    } else if (pct > 0) {
      points += 3;
      factors.push({
        code: "holders_growing",
        message: "Holder count growing",
        tone: "positive",
        weight: 6,
      });
    } else if (
      growth.absolute <= -HOLDERS_FALLING_ABS ||
      pct <= -HOLDERS_FALLING_PCT
    ) {
      points -= 4;
      factors.push({
        code: "holders_falling",
        message: `Holder count falling (${growth.window})`,
        tone: "warning",
        weight: 10,
      });
    } else {
      points -= 2;
      factors.push({
        code: "holders_soft_down",
        message: "Holder count declining",
        tone: "warning",
        weight: 5,
      });
    }
  }

  if (whale?.available) {
    const lPp = whale.largestDeltaPp;
    const tPp = whale.top10DeltaPp;
    const lStable =
      lPp == null || Math.abs(lPp) < SCORE_DEADZONE.concentrationPp;
    const tStable =
      tPp == null || Math.abs(tPp) < SCORE_DEADZONE.concentrationPp;

    if (!lStable && lPp != null && lPp <= -CONCENTRATION_MATERIAL_PP) {
      points += 2.5;
      factors.push({
        code: "largest_falling",
        message: `Largest holder share decreasing (${Math.abs(lPp).toFixed(1)}pp)`,
        tone: "positive",
        weight: 7,
      });
    } else if (!lStable && lPp != null && lPp >= CONCENTRATION_MATERIAL_PP) {
      points -= 2.5;
      factors.push({
        code: "largest_rising",
        message: `Largest wallet share rising (${lPp.toFixed(1)}pp)`,
        tone: "warning",
        weight: 9,
      });
    }

    if (!tStable && tPp != null && tPp <= -CONCENTRATION_MATERIAL_PP) {
      points += 2.5;
      factors.push({
        code: "top10_falling",
        message: `Top 10 concentration decreasing (${Math.abs(tPp).toFixed(1)}pp)`,
        tone: "positive",
        weight: 7,
      });
    } else if (!tStable && tPp != null && tPp >= CONCENTRATION_MATERIAL_PP) {
      points -= 2.5;
      factors.push({
        code: "top10_rising",
        message: `Top 10 concentration rising (${tPp.toFixed(1)}pp)`,
        tone: "warning",
        weight: 9,
      });
    }

    // Combined: holders falling while concentration rises
    if (
      growth &&
      (growth.absolute <= -HOLDERS_FALLING_ABS ||
        growth.percent <= -HOLDERS_FALLING_PCT) &&
      ((lPp != null && lPp >= CONCENTRATION_MATERIAL_PP) ||
        (tPp != null && tPp >= CONCENTRATION_MATERIAL_PP))
    ) {
      points -= 2;
      factors.push({
        code: "fall_and_concentrate",
        message: "Holder count falling while concentration rises",
        tone: "warning",
        weight: 12,
      });
    }
  }

  return {
    id: "holderTrend",
    label: "Holder Trend",
    max,
    points: round1(clamp(points, 0, max)),
    neutralMissing: false,
  };
}

function scoreWhale(
  whaleActivity: WhaleActivityFacts | null | undefined,
  security: TokenSecurityFacts,
  holderIntel: HolderIntelV2Facts | null,
  factors: AxiomScoreFactor[],
): AxiomScoreCategory {
  const max = AXIOM_SCORE_WEIGHTS.whale;

  if (!whaleActivity || whaleActivity.status !== "ready") {
    return {
      id: "whale",
      label: "Whale Behavior",
      max,
      points: max / 2,
      neutralMissing: true,
    };
  }

  if (!whaleActivity.events.length) {
    // Quiet token — neutral-positive (no significant activity)
    return {
      id: "whale",
      label: "Whale Behavior",
      max,
      points: round1(max * 0.6),
      neutralMissing: false,
    };
  }

  let points = max / 2;
  const riskEvents = whaleActivity.events.filter((e) => e.riskRelevant);
  const displayEvents = whaleActivity.events;

  const majorSells = riskEvents.filter(
    (e) =>
      e.kind === "confirmed_sell" &&
      (e.major || e.isTopHolder) &&
      (e.usdValue == null || e.usdValue >= SCORE_DEADZONE.whaleUsd),
  );
  const majorDist = riskEvents.filter(
    (e) =>
      e.major &&
      (e.kind === "distribution" ||
        e.kind === "balance_decrease" ||
        e.kind === "top_holder_transfer"),
  );
  const bigSupply = displayEvents.find(
    (e) => e.supplyPct >= WHALE_SUPPLY_MAJOR_PCT,
  );
  const healthyAccum = riskEvents.filter(
    (e) =>
      (e.kind === "confirmed_buy" || e.kind === "accumulation") &&
      e.major &&
      (e.usdValue == null || e.usdValue >= SCORE_DEADZONE.whaleUsd),
  );

  if (majorSells.length) {
    points -= Math.min(6, 3 + majorSells.length);
    const top = majorSells[0]!;
    const usd =
      top.netUsd != null
        ? Math.abs(top.netUsd)
        : top.usdValue != null
          ? top.usdValue
          : null;
    const swapN = top.buyCount + top.sellCount;
    factors.push({
      code: "major_sell",
      message:
        top.aggregated && swapN > 1 && usd != null
          ? `Major holder net sold ~$${usd >= 1000 ? `${(usd / 1000).toFixed(1)}K` : Math.round(usd)} across ${swapN} swaps`
          : "Large confirmed sell from a major holder",
      tone: "warning",
      weight: 11,
    });
  }

  if (majorDist.length) {
    points -= 3;
    factors.push({
      code: "distribution",
      message: "Significant distribution from large holders",
      tone: "warning",
      weight: 8,
    });
  }

  if (bigSupply) {
    points -= 2;
    factors.push({
      code: "supply_moved",
      message: `Large share of supply moved (${bigSupply.supplyPct.toFixed(1)}%)`,
      tone: "warning",
      weight: 8,
    });
  }

  const dangerousConc =
    (security.topHolderPct != null &&
      security.topHolderPct >= RISK_TOP_HOLDER_MEDIUM_PCT) ||
    (security.top10HolderPct != null &&
      security.top10HolderPct >= RISK_TOP10_MEDIUM_PCT);

  if (healthyAccum.length && !dangerousConc) {
    points += 3;
    factors.push({
      code: "healthy_accum",
      message: "Significant accumulation without dangerous concentration",
      tone: "positive",
      weight: 6,
    });
  } else if (healthyAccum.length && dangerousConc) {
    points -= 1;
    factors.push({
      code: "accum_into_conc",
      message: "Accumulation alongside elevated concentration",
      tone: "warning",
      weight: 7,
    });
  }

  // Structural: holder growth + falling concentration (from history) soft-boosts whale category
  const growthUp = holderIntel?.growth.available
    ? holderIntel.growth.deltas.some(
        (d) =>
          (d.window === "1h" || d.window === "6h" || d.window === "5m") &&
          d.percent > SCORE_DEADZONE.holderGrowthPct,
      )
    : false;
  const concDown =
    holderIntel?.whale.available &&
    ((holderIntel.whale.largestTrend === "decreasing" &&
      holderIntel.whale.largestDeltaPp != null &&
      Math.abs(holderIntel.whale.largestDeltaPp) >= CONCENTRATION_MATERIAL_PP) ||
      (holderIntel.whale.top10Trend === "decreasing" &&
        holderIntel.whale.top10DeltaPp != null &&
        Math.abs(holderIntel.whale.top10DeltaPp) >= CONCENTRATION_MATERIAL_PP));
  if (growthUp && concDown) {
    points += 2;
    factors.push({
      code: "grow_deconcentrate",
      message: "Holder base growing while concentration falls",
      tone: "positive",
      weight: 7,
    });
  }

  return {
    id: "whale",
    label: "Whale Behavior",
    max,
    points: round1(clamp(points, 0, max)),
    neutralMissing: false,
  };
}

function computeConfidence(input: {
  security: TokenSecurityFacts;
  market: TokenMarketFacts;
  trading: TokenTradingFacts;
  holderIntel: HolderIntelV2Facts | null;
  whaleActivity: WhaleActivityFacts | null | undefined;
  categories: AxiomScoreCategory[];
}): AxiomDataConfidence {
  const { security, market, trading, holderIntel, whaleActivity, categories } =
    input;
  let checks = 0;
  let hits = 0;

  checks += 1;
  if (security.authoritiesAvailable) hits += 1;

  checks += 1;
  if (market.available && market.liquidityUsd != null) hits += 1;

  checks += 1;
  if (security.holdersAvailable) hits += 1;

  checks += 1;
  if (trading.routeAvailable !== null) hits += 1;

  checks += 1;
  if (holderIntel?.growth.available || holderIntel?.whale.available) hits += 1;

  checks += 1;
  if (whaleActivity?.status === "ready") hits += 1;

  const missingNeutral = categories.filter((c) => c.neutralMissing).length;
  const ratio = hits / checks;

  if (ratio >= 0.85 && missingNeutral <= 1) return "HIGH";
  if (ratio >= 0.5 && security.holdersAvailable) return "MEDIUM";
  return "LOW";
}

/**
 * Compute Axiom Score from existing Token Intelligence inputs.
 * Safe for Token Detail; discovery may call with whale/history null (neutral).
 */
export function computeAxiomScore(input: {
  market: TokenMarketFacts;
  security: TokenSecurityFacts;
  trading: TokenTradingFacts;
  holderIntel?: HolderIntelV2Facts | null;
  whaleActivity?: WhaleActivityFacts | null;
  riskReasons?: RiskReason[];
}): AxiomScoreResult {
  const holderIntel = input.holderIntel ?? null;
  const whaleActivity = input.whaleActivity ?? null;
  const factors: AxiomScoreFactor[] = [];

  const categories = [
    scoreSecurity(input.security, input.trading, factors),
    scoreHolders(input.security, factors),
    scoreLiquidity(input.market, input.trading, factors),
    scoreHolderTrend(holderIntel, factors),
    scoreWhale(whaleActivity, input.security, holderIntel, factors),
  ];

  const raw = categories.reduce((s, c) => s + c.points, 0);
  const score = Math.round(clamp(raw, 0, 100));
  const { band, label } = classifyAxiomScore(score);

  const reasons = input.riskReasons ?? [];
  const mapped = mapAxiomScoreToRiskLevel(score, {
    reasons,
    security: input.security,
  });

  const confidence = computeConfidence({
    security: input.security,
    market: input.market,
    trading: input.trading,
    holderIntel,
    whaleActivity,
    categories,
  });

  // Dedupe by code, keep strongest weight, split tone
  const byCode = new Map<string, AxiomScoreFactor>();
  for (const f of factors) {
    const prev = byCode.get(f.code);
    if (!prev || f.weight > prev.weight) byCode.set(f.code, f);
  }
  const uniq = [...byCode.values()];
  const positives = uniq
    .filter((f) => f.tone === "positive")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);
  const warnings = uniq
    .filter((f) => f.tone === "warning")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  return {
    score,
    band,
    label,
    confidence,
    categories,
    positives,
    warnings,
    mappedRiskLevel: mapped.level,
    criticalOverride: mapped.criticalOverride,
    criticalOverrideReason: mapped.reason,
    computedAt: Date.now(),
  };
}

/**
 * Align Risk badge with Axiom Score.
 * Preserves UNKNOWN when the risk engine lacks enough evidence.
 */
export function alignRiskWithAxiomScore(
  risk: TokenRiskAssessment,
  score: AxiomScoreResult,
): TokenRiskAssessment {
  if (risk.level === "UNKNOWN") {
    return {
      ...risk,
      assessedAt: Date.now(),
    };
  }

  return {
    level: score.mappedRiskLevel,
    reasons: risk.reasons,
    assessedAt: Date.now(),
  };
}

/**
 * Shared finalize path for Token Detail (and future lightweight discovery).
 * Computes explainable score + keeps Risk badge consistent with it.
 */
export function finalizeRiskAndScore(input: {
  market: TokenMarketFacts;
  security: TokenSecurityFacts;
  trading: TokenTradingFacts;
  holderIntel?: HolderIntelV2Facts | null;
  whaleActivity?: WhaleActivityFacts | null;
  isNativeSol?: boolean;
}): { risk: TokenRiskAssessment; axiomScore: AxiomScoreResult } {
  const risk = assessTokenRisk(input);
  const axiomScore = computeAxiomScore({
    market: input.market,
    security: input.security,
    trading: input.trading,
    holderIntel: input.holderIntel ?? null,
    whaleActivity: input.whaleActivity ?? null,
    riskReasons: risk.reasons,
  });

  if (risk.level === "UNKNOWN") {
    return {
      risk,
      axiomScore: { ...axiomScore, mappedRiskLevel: "UNKNOWN" },
    };
  }

  return {
    risk: alignRiskWithAxiomScore(risk, axiomScore),
    axiomScore,
  };
}

/** Attach score + aligned risk onto an intelligence payload. */
export function withAxiomScore(
  intel: TokenIntelligence,
  isNativeSol = false,
): TokenIntelligence {
  const { risk, axiomScore } = finalizeRiskAndScore({
    market: intel.market,
    security: intel.security,
    trading: intel.trading,
    holderIntel: intel.holderIntel,
    whaleActivity: intel.whaleActivity,
    isNativeSol,
  });
  return {
    ...intel,
    risk,
    axiomScore,
    updatedAt: Date.now(),
  };
}

/**
 * Lightweight path shared with discovery — prefer
 * `computeLightweightAxiomScore` for LIVE rows (TokenAsset + enrichment).
 * Uses only market/security/trading facts — no whale / holder-history RPC.
 * Missing history/whale categories contribute neutrally.
 */
export function computeAxiomScoreLite(input: {
  market: TokenMarketFacts;
  security: TokenSecurityFacts;
  trading: TokenTradingFacts;
}): AxiomScoreResult {
  return computeAxiomScore({
    market: input.market,
    security: input.security,
    trading: input.trading,
    holderIntel: null,
    whaleActivity: null,
  });
}
