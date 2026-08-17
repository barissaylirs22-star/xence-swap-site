import type {
  HolderIntelV2Facts,
  RiskLevel,
  RiskReason,
  TokenMarketFacts,
  TokenRiskAssessment,
  TokenSecurityFacts,
  TokenTradingFacts,
  WhaleActivityFacts,
} from "./types";
import {
  CONCENTRATION_MATERIAL_PP,
  CONCENTRATION_SHORT_RISK_PP,
  HOLDERS_FALLING_ABS,
  HOLDERS_FALLING_PCT,
} from "./holderHistory";
import { WHALE_SUPPLY_MAJOR_PCT } from "./whaleThresholds";

/** Liquidity below this USD amount → "very low liquidity" reason. */
export const RISK_VERY_LOW_LIQUIDITY_USD = 1_000;

/** Listed within this window → "very new token" reason. */
export const RISK_VERY_NEW_MS = 24 * 60 * 60 * 1000;

/** Top holder share at/above this → high concentration (MEDIUM floor). */
export const RISK_TOP_HOLDER_MEDIUM_PCT = 35;

/** Top holder share at/above this → HIGH. */
export const RISK_TOP_HOLDER_HIGH_PCT = 50;

/** Top-10 share at/above this → MEDIUM floor. */
export const RISK_TOP10_MEDIUM_PCT = 70;

/** Top-10 share at/above this → HIGH. */
export const RISK_TOP10_HIGH_PCT = 85;

function formatWhaleUsd(n: number): string {
  if (n >= 1_000_000) return `~$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `~$${(n / 1_000).toFixed(1)}K`;
  return `~$${Math.round(n)}`;
}

/**
 * Risk Engine V1 — explainable, fail-soft.
 * Never emits "SCAM". Missing data → UNKNOWN / insufficient_data, not HIGH.
 */
export function assessTokenRisk(input: {
  market: TokenMarketFacts;
  security: TokenSecurityFacts;
  trading: TokenTradingFacts;
  isNativeSol?: boolean;
  holderIntel?: HolderIntelV2Facts | null;
  whaleActivity?: WhaleActivityFacts | null;
}): TokenRiskAssessment {
  const reasons: RiskReason[] = [];
  let high = false;
  let medium = false;

  if (input.isNativeSol) {
    return {
      level: "LOW",
      reasons: [],
      assessedAt: Date.now(),
    };
  }

  const { market, security, trading } = input;
  const holdersPending =
    security.holdersPending || security.holdersStatus === "pending";

  if (security.mintAuthorityActive === true) {
    reasons.push({
      code: "mint_authority_active",
      message: "Mint authority active",
    });
    medium = true;
  }

  if (security.freezeAuthorityActive === true) {
    reasons.push({
      code: "freeze_authority_active",
      message: "Freeze authority active",
    });
    medium = true;
  }

  if (
    market.liquidityUsd != null &&
    Number.isFinite(market.liquidityUsd) &&
    market.liquidityUsd < RISK_VERY_LOW_LIQUIDITY_USD
  ) {
    reasons.push({
      code: "very_low_liquidity",
      message: "Very low liquidity",
    });
    medium = true;
    if (
      market.ageMs != null &&
      market.ageMs < RISK_VERY_NEW_MS &&
      market.liquidityUsd < RISK_VERY_LOW_LIQUIDITY_USD / 2
    ) {
      high = true;
    }
  }

  if (trading.veryNewTokenWarning || (market.ageMs != null && market.ageMs < RISK_VERY_NEW_MS)) {
    if (!reasons.some((r) => r.code === "very_new_token")) {
      reasons.push({
        code: "very_new_token",
        message: "Very new token",
      });
    }
    medium = true;
  }

  if (
    security.topHolderPct != null &&
    Number.isFinite(security.topHolderPct)
  ) {
    if (security.topHolderPct >= RISK_TOP_HOLDER_HIGH_PCT) {
      reasons.push({
        code: "high_holder_concentration",
        message: "High holder concentration",
      });
      high = true;
    } else if (security.topHolderPct >= RISK_TOP_HOLDER_MEDIUM_PCT) {
      reasons.push({
        code: "high_holder_concentration",
        message: "High holder concentration",
      });
      medium = true;
    }
  }

  if (
    security.top10HolderPct != null &&
    Number.isFinite(security.top10HolderPct)
  ) {
    if (security.top10HolderPct >= RISK_TOP10_HIGH_PCT) {
      reasons.push({
        code: "high_top10_concentration",
        message: "High top-10 holder concentration",
      });
      high = true;
    } else if (security.top10HolderPct >= RISK_TOP10_MEDIUM_PCT) {
      reasons.push({
        code: "high_top10_concentration",
        message: "High top-10 holder concentration",
      });
      medium = true;
    }
  }

  // Holder Intelligence V2 — additive warnings from real local history only.
  // Prefer 1h/6h; 5m alone requires a stronger concentration bar so brief noise
  // does not dominate the overall risk rating.
  const v2 = input.holderIntel;
  let holdersFalling = false;
  let concentrationRising = false;

  if (v2?.growth.available) {
    const rapid = v2.growth.deltas.find((d) => {
      if (d.window !== "1h" && d.window !== "6h" && d.window !== "5m") {
        return false;
      }
      // 5m: require both absolute AND percent thresholds (stricter).
      if (d.window === "5m") {
        return (
          d.absolute <= -HOLDERS_FALLING_ABS &&
          d.percent <= -HOLDERS_FALLING_PCT
        );
      }
      return (
        d.absolute <= -HOLDERS_FALLING_ABS || d.percent <= -HOLDERS_FALLING_PCT
      );
    });
    if (rapid) {
      holdersFalling = true;
      reasons.push({
        code: "holders_falling_rapidly",
        message: `Holder count falling rapidly (${rapid.absolute} in ${rapid.window})`,
      });
      medium = true;
    }
  }

  if (v2?.whale.available) {
    const pref = v2.whale.preferredWindow;
    const shortOnly = pref === "5m";
    const largestBar = shortOnly
      ? CONCENTRATION_SHORT_RISK_PP
      : CONCENTRATION_MATERIAL_PP;
    const top10Bar = shortOnly
      ? CONCENTRATION_SHORT_RISK_PP
      : CONCENTRATION_MATERIAL_PP;

    if (
      v2.whale.largestTrend === "increasing" &&
      v2.whale.largestDeltaPp != null &&
      v2.whale.largestDeltaPp >= largestBar
    ) {
      concentrationRising = true;
      reasons.push({
        code: "largest_holder_share_rising",
        message: `Largest holder share increasing materially (${v2.whale.largestDeltaPp.toFixed(1)}pp${pref ? ` · ${pref}` : ""})`,
      });
      medium = true;
    }
    if (
      v2.whale.top10Trend === "increasing" &&
      v2.whale.top10DeltaPp != null &&
      v2.whale.top10DeltaPp >= top10Bar
    ) {
      concentrationRising = true;
      reasons.push({
        code: "top10_concentration_rising",
        message: `Top 10 concentration rising significantly (${v2.whale.top10DeltaPp.toFixed(1)}pp${pref ? ` · ${pref}` : ""})`,
      });
      medium = true;
    }
  }

  if (holdersFalling && concentrationRising) {
    reasons.push({
      code: "holders_falling_concentration_rising",
      message:
        "Holder count falling while whale concentration rises",
    });
    medium = true;
  }

  // Whale Activity — only riskRelevant events (post significance filter).
  const whale = input.whaleActivity;
  if (whale?.status === "ready" && whale.events.length) {
    const riskEvents = whale.events.filter((e) => e.riskRelevant);
    const majorDist = riskEvents.filter(
      (e) =>
        e.major &&
        (e.kind === "distribution" ||
          e.kind === "balance_decrease" ||
          e.kind === "top_holder_transfer" ||
          e.kind === "confirmed_sell"),
    );
    if (majorDist.length >= 2) {
      reasons.push({
        code: "major_holder_distribution",
        message: "Multiple significant distributions from large holders",
      });
      medium = true;
    } else if (majorDist.length === 1 && majorDist[0]!.isTopHolder) {
      reasons.push({
        code: "major_holder_distribution",
        message: "Major holder balance decreasing significantly",
      });
      medium = true;
    }

    const confirmedSell = riskEvents.find(
      (e) =>
        e.kind === "confirmed_sell" &&
        e.isTopHolder &&
        (e.major || e.supplyPct >= WHALE_SUPPLY_MAJOR_PCT * 0.5),
    );
    if (confirmedSell) {
      const swapN = confirmedSell.buyCount + confirmedSell.sellCount;
      const netAbs =
        confirmedSell.netUsd != null
          ? Math.abs(confirmedSell.netUsd)
          : confirmedSell.usdValue;
      const detail =
        confirmedSell.aggregated &&
        swapN > 1 &&
        netAbs != null &&
        netAbs > 0
          ? `Major holder net selling detected: ${formatWhaleUsd(netAbs)} across ${swapN} confirmed swaps`
          : "Large confirmed sell from a major holder";
      reasons.push({
        code: "large_confirmed_sell_major_holder",
        message: detail,
      });
      medium = true;
    }

    const bigMove = riskEvents.find(
      (e) => e.supplyPct >= WHALE_SUPPLY_MAJOR_PCT,
    );
    if (bigMove) {
      reasons.push({
        code: "large_supply_moved",
        message: `Large percentage of supply moved (${bigMove.supplyPct.toFixed(1)}%)`,
      });
      medium = true;
    }
  }

  if (trading.routeAvailable === false) {
    reasons.push({
      code: "no_jupiter_route",
      message: "No Jupiter route",
    });
    medium = true;
  }

  // Price impact — same thresholds as explainability (impact.ts).
  if (trading.priceImpactLevel === "high") {
    reasons.push({
      code: "high_price_impact",
      message: "High estimated price impact",
    });
    medium = true;
  } else if (trading.priceImpactLevel === "elevated") {
    reasons.push({
      code: "elevated_price_impact",
      message: "Elevated estimated price impact",
    });
    medium = true;
  } else if (trading.priceImpactLevel === "moderate") {
    reasons.push({
      code: "moderate_price_impact",
      message: "Moderate estimated price impact",
    });
    medium = true;
  }

  const hasAuthoritySignal = security.authoritiesAvailable;
  const hasMarketSignal = market.available;
  const hasRouteSignal = trading.routeAvailable !== null;
  const hasHolderSignal = security.holdersAvailable;
  const holdersSettledUnavailable =
    !holdersPending &&
    !hasHolderSignal &&
    (security.holdersStatus === "unavailable" ||
      security.holdersStatus === "error");

  const assessable =
    hasAuthoritySignal || hasMarketSignal || hasRouteSignal || hasHolderSignal;

  if (!assessable) {
    return {
      level: "UNKNOWN",
      reasons: [
        {
          code: "insufficient_data",
          message: "Insufficient data",
        },
      ],
      assessedAt: Date.now(),
    };
  }

  // Authorities unknown + almost no other signals → still UNKNOWN rather than LOW.
  if (
    !hasAuthoritySignal &&
    !hasHolderSignal &&
    !hasMarketSignal &&
    trading.routeAvailable !== true
  ) {
    reasons.push({
      code: "insufficient_data",
      message: "Insufficient data",
    });
    return {
      level: "UNKNOWN",
      reasons,
      assessedAt: Date.now(),
    };
  }

  let level: RiskLevel;
  if (high) level = "HIGH";
  else if (medium) level = "MEDIUM";
  else if (holdersPending) {
    // Other signals may look clean, but holder concentration is still expected.
    level = "UNKNOWN";
    reasons.push({
      code: "holders_analysis_pending",
      message: "Holder concentration analysis pending",
    });
  } else if (
    hasAuthoritySignal &&
    security.mintAuthorityActive === false &&
    security.freezeAuthorityActive === false &&
    (trading.routeAvailable === true || hasMarketSignal)
  ) {
    // Clean controls + market/route — but holder concentration unverified
    // must not read as confirmed LOW.
    if (holdersSettledUnavailable) {
      level = "UNKNOWN";
      reasons.push({
        code: "holders_data_unavailable",
        message: "Holder concentration unavailable",
      });
    } else {
      level = "LOW";
    }
  } else if (reasons.length === 0 && (hasMarketSignal || hasRouteSignal)) {
    // Partial positive signal without authority confirmation → UNKNOWN, not LOW.
    level = hasAuthoritySignal && !holdersSettledUnavailable ? "LOW" : "UNKNOWN";
    if (level === "UNKNOWN") {
      if (holdersSettledUnavailable) {
        reasons.push({
          code: "holders_data_unavailable",
          message: "Holder concentration unavailable",
        });
      } else {
        reasons.push({
          code: "insufficient_data",
          message: "Insufficient data",
        });
      }
    }
  } else if (reasons.length === 0) {
    level = "UNKNOWN";
    reasons.push({
      code:
        holdersSettledUnavailable
          ? "holders_data_unavailable"
          : "insufficient_data",
      message: holdersSettledUnavailable
        ? "Holder concentration unavailable"
        : "Insufficient data",
    });
  } else {
    level = medium ? "MEDIUM" : "UNKNOWN";
    if (holdersSettledUnavailable && level === "UNKNOWN") {
      reasons.push({
        code: "holders_data_unavailable",
        message: "Holder concentration unavailable",
      });
    }
  }

  return {
    level,
    reasons,
    assessedAt: Date.now(),
  };
}
