import type {
  HolderIntelV2Facts,
  RiskLevel,
  RiskReason,
  TokenIntelligence,
  TokenMarketFacts,
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
  RISK_TOP10_MEDIUM_PCT,
  RISK_TOP_HOLDER_MEDIUM_PCT,
  RISK_VERY_NEW_MS,
} from "./risk";

/** Liquidity at/above this (when known) → healthy liquidity positive. */
export const POSITIVE_HEALTHY_LIQUIDITY_USD = 10_000;

/** Meta / gap codes — belong under confidence, not the Why list. */
const WHY_META_CODES = new Set([
  "insufficient_data",
  "holders_data_unavailable",
  "holders_analysis_pending",
]);

export type RiskDataConfidence = "HIGH" | "MEDIUM" | "LOW";

export type PositiveSignalCode =
  | "mint_authority_revoked"
  | "freeze_authority_revoked"
  | "jupiter_route_available"
  | "healthy_liquidity"
  | "low_largest_holder"
  | "low_top10_holders"
  | "low_price_impact"
  | "holders_rising_concentration_falling"
  | "distribution_becoming_healthier"
  | "largest_share_falling_stable_base"
  | "significant_accumulation_healthy";

export interface PositiveSignal {
  code: PositiveSignalCode;
  message: string;
}

export interface RiskExplanation {
  level: RiskLevel;
  summary: string;
  positiveSignals: PositiveSignal[];
  riskSignals: RiskReason[];
  /** Deterministic availability of core inputs — not a second risk score. */
  dataConfidence: RiskDataConfidence;
}

/**
 * Data confidence from whether core Risk inputs are actually present.
 * Does not raise or lower the Risk level.
 *
 * HIGH — authorities + holder concentration + market facts all available
 * MEDIUM — exactly two of those three
 * LOW — zero or one of those three
 */
export function assessRiskDataConfidence(input: {
  market: TokenMarketFacts;
  security: TokenSecurityFacts;
  isNativeSol?: boolean;
}): RiskDataConfidence {
  if (input.isNativeSol) return "HIGH";

  const securityOk = input.security.authoritiesAvailable === true;
  const holdersOk = input.security.holdersAvailable === true;
  const marketOk = input.market.available === true;
  const present = [securityOk, holdersOk, marketOk].filter(Boolean).length;

  if (present >= 3) return "HIGH";
  if (present === 2) return "MEDIUM";
  return "LOW";
}

/**
 * Derive display-only positive signals from known TokenIntelligence fields.
 * Never invents positives for missing data.
 * Unknown authorities are never shown as revoked.
 */
export function buildPositiveSignals(input: {
  market: TokenMarketFacts;
  security: TokenSecurityFacts;
  trading: TokenTradingFacts;
  isNativeSol?: boolean;
  holderIntel?: HolderIntelV2Facts | null;
  whaleActivity?: WhaleActivityFacts | null;
}): PositiveSignal[] {
  const { market, security, trading, isNativeSol, holderIntel, whaleActivity } =
    input;
  const out: PositiveSignal[] = [];

  const authoritiesKnown =
    isNativeSol === true || security.authoritiesAvailable === true;

  if (
    authoritiesKnown &&
    (isNativeSol || security.mintAuthorityActive === false)
  ) {
    out.push({
      code: "mint_authority_revoked",
      message: "Mint authority revoked",
    });
  }

  if (
    authoritiesKnown &&
    (isNativeSol || security.freezeAuthorityActive === false)
  ) {
    out.push({
      code: "freeze_authority_revoked",
      message: "Freeze authority revoked",
    });
  }

  if (trading.routeAvailable === true) {
    out.push({
      code: "jupiter_route_available",
      message: "Jupiter route available",
    });
  }

  if (
    market.liquidityUsd != null &&
    Number.isFinite(market.liquidityUsd) &&
    market.liquidityUsd >= POSITIVE_HEALTHY_LIQUIDITY_USD
  ) {
    out.push({
      code: "healthy_liquidity",
      message: "Healthy liquidity",
    });
  }

  if (
    security.holdersAvailable &&
    security.topHolderPct != null &&
    Number.isFinite(security.topHolderPct) &&
    security.topHolderPct < RISK_TOP_HOLDER_MEDIUM_PCT
  ) {
    out.push({
      code: "low_largest_holder",
      message: `Largest holder: ${security.topHolderPct.toFixed(1)}%`,
    });
  }

  if (
    security.holdersAvailable &&
    security.top10HolderPct != null &&
    Number.isFinite(security.top10HolderPct) &&
    security.top10HolderPct < RISK_TOP10_MEDIUM_PCT
  ) {
    out.push({
      code: "low_top10_holders",
      message: `Top 10 holders: ${security.top10HolderPct.toFixed(1)}%`,
    });
  }

  if (trading.priceImpactPct != null && trading.priceImpactLevel === "low") {
    out.push({
      code: "low_price_impact",
      message: `Low estimated price impact (${trading.priceImpactPct.toFixed(1)}%)`,
    });
  }

  // V2 — only from real local history.
  if (holderIntel?.growth.available && holderIntel.whale.available) {
    const rising = holderIntel.growth.deltas.some(
      (d) =>
        (d.window === "1h" || d.window === "6h" || d.window === "5m") &&
        d.absolute > 0,
    );
    const concFalling =
      holderIntel.whale.largestTrend === "decreasing" ||
      holderIntel.whale.top10Trend === "decreasing";
    if (rising && concFalling) {
      out.push({
        code: "holders_rising_concentration_falling",
        message: "Holder count rising while concentration falls",
      });
    }
  }

  if (
    holderIntel?.whale.available &&
    ((holderIntel.whale.top10Trend === "decreasing" &&
      holderIntel.whale.top10DeltaPp != null &&
      Math.abs(holderIntel.whale.top10DeltaPp) >= CONCENTRATION_MATERIAL_PP) ||
      (holderIntel.whale.largestTrend === "decreasing" &&
        holderIntel.whale.largestDeltaPp != null &&
        Math.abs(holderIntel.whale.largestDeltaPp) >=
          CONCENTRATION_MATERIAL_PP))
  ) {
    out.push({
      code: "distribution_becoming_healthier",
      message: "Holder distribution becoming healthier",
    });
  }

  // Largest share falling without holder-count collapse.
  if (
    holderIntel?.whale.available &&
    holderIntel.whale.largestTrend === "decreasing" &&
    holderIntel.whale.largestDeltaPp != null &&
    Math.abs(holderIntel.whale.largestDeltaPp) >= CONCENTRATION_MATERIAL_PP
  ) {
    const collapsing = holderIntel.growth.available
      ? holderIntel.growth.deltas.some(
          (d) =>
            (d.window === "1h" || d.window === "6h") &&
            (d.absolute <= -HOLDERS_FALLING_ABS ||
              d.percent <= -HOLDERS_FALLING_PCT),
        )
      : false;
    if (!collapsing) {
      out.push({
        code: "largest_share_falling_stable_base",
        message:
          "Largest holder share falling without a collapse in holder count",
      });
    }
  }

  if (whaleActivity?.status === "ready") {
    const accum = whaleActivity.events.filter(
      (e) =>
        e.riskRelevant &&
        (e.kind === "accumulation" ||
          e.kind === "confirmed_buy" ||
          (e.kind === "balance_increase" && e.major)),
    );
    const dangerousConc =
      (security.topHolderPct != null &&
        security.topHolderPct >= RISK_TOP_HOLDER_MEDIUM_PCT) ||
      (security.top10HolderPct != null &&
        security.top10HolderPct >= RISK_TOP10_MEDIUM_PCT);
    const concFalling =
      holderIntel?.whale.available &&
      (holderIntel.whale.largestTrend === "decreasing" ||
        holderIntel.whale.top10Trend === "decreasing");

    if (
      accum.some((e) => e.major || e.kind === "accumulation") &&
      !dangerousConc &&
      (concFalling ||
        (security.topHolderPct != null &&
          security.topHolderPct < RISK_TOP_HOLDER_MEDIUM_PCT))
    ) {
      out.push({
        code: "significant_accumulation_healthy",
        message:
          "Significant accumulation without dangerous concentration",
      });
    }
  }

  return out;
}

function formatTokenAgeMessage(ageMs: number): string {
  if (ageMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.round(ageMs / 60_000));
    return `Token is only ${mins}m old`;
  }
  if (ageMs < RISK_VERY_NEW_MS * 2) {
    const hours = Math.max(1, Math.round(ageMs / 3_600_000));
    return `Token is only ${hours}h old`;
  }
  const days = Math.max(1, Math.round(ageMs / 86_400_000));
  return `Token is ${days}d old`;
}

/**
 * Enrich risk reason messages with known numeric context when available.
 * Does not add new risk codes or change thresholds.
 */
export function formatRiskSignalMessage(
  reason: RiskReason,
  intel: Pick<TokenIntelligence, "market" | "security" | "trading">,
): string {
  switch (reason.code) {
    case "very_low_liquidity":
      if (intel.market.liquidityUsd != null) {
        return `Very low liquidity ($${Math.round(intel.market.liquidityUsd).toLocaleString()})`;
      }
      return reason.message;
    case "very_new_token":
      if (intel.market.ageMs != null && Number.isFinite(intel.market.ageMs)) {
        return formatTokenAgeMessage(intel.market.ageMs);
      }
      return reason.message;
    case "high_holder_concentration":
      if (intel.security.topHolderPct != null) {
        return `Largest holder controls ${intel.security.topHolderPct.toFixed(1)}%`;
      }
      return reason.message;
    case "high_top10_concentration":
      if (intel.security.top10HolderPct != null) {
        return `Top 10 holders control ${intel.security.top10HolderPct.toFixed(1)}%`;
      }
      return reason.message;
    case "no_jupiter_route":
      return "Jupiter route unavailable";
    case "moderate_price_impact":
      if (intel.trading.priceImpactPct != null) {
        return `Moderate estimated price impact (${intel.trading.priceImpactPct.toFixed(1)}%)`;
      }
      return reason.message;
    case "elevated_price_impact":
      if (intel.trading.priceImpactPct != null) {
        return `Elevated estimated price impact (${intel.trading.priceImpactPct.toFixed(1)}%)`;
      }
      return reason.message;
    case "high_price_impact":
      if (intel.trading.priceImpactPct != null) {
        return `High estimated price impact (${intel.trading.priceImpactPct.toFixed(1)}%)`;
      }
      return reason.message;
    default:
      return reason.message;
  }
}

/**
 * Deterministic summary from Risk V1 level + known signals only.
 */
export function summarizeRiskAssessment(
  level: RiskLevel,
  reasons: RiskReason[],
  positives: PositiveSignal[],
  options?: { holdersStatus?: string | null },
): string {
  const holdersPending = options?.holdersStatus === "pending";
  const holdersUnavailable =
    options?.holdersStatus === "unavailable" ||
    options?.holdersStatus === "error";

  if (holdersPending) {
    return "Risk assessment is incomplete while holder concentration is still loading.";
  }

  switch (level) {
    case "LOW":
      return "No major risk indicators detected from the currently available data.";
    case "HIGH":
      return "Multiple elevated risk indicators were detected. Review Why below before trading.";
    case "UNKNOWN":
      if (holdersUnavailable) {
        return "No elevated risks detected in available data, but holder concentration could not be verified.";
      }
      return "Not enough reliable data is available to determine a risk level.";
    case "MEDIUM": {
      const codes = new Set(reasons.map((r) => r.code));
      const onlyNew = reasons.length === 1 && codes.has("very_new_token");
      const controlsOk =
        positives.some((p) => p.code === "mint_authority_revoked") &&
        positives.some((p) => p.code === "freeze_authority_revoked");

      if (onlyNew && controlsOk) {
        return "Mostly healthy token controls, but this token is extremely new.";
      }
      if (onlyNew) {
        return "This token is extremely new. Review Why below before trading.";
      }
      if (
        reasons.length > 0 &&
        [...codes].every(
          (c) => c === "very_new_token" || c === "very_low_liquidity",
        )
      ) {
        return "Caution: limited market maturity or liquidity based on available data.";
      }
      if (holdersUnavailable) {
        return "Some caution signals were detected. Holder concentration could not be verified.";
      }
      return "Some caution signals were detected. Review Why below before trading.";
    }
    default:
      return "Not enough reliable data is available to determine a risk level.";
  }
}

/**
 * Full explainable Risk V2 view model for Token Detail UI.
 * Why / Positive / Data confidence — no second risk algorithm.
 */
export function explainTokenRisk(
  intel: TokenIntelligence,
  options?: { isNativeSol?: boolean },
): RiskExplanation {
  const isNativeSol = options?.isNativeSol === true;
  const positiveSignals = buildPositiveSignals({
    market: intel.market,
    security: intel.security,
    trading: intel.trading,
    isNativeSol,
    holderIntel: intel.holderIntel,
    whaleActivity: intel.whaleActivity,
  });

  const dataConfidence = assessRiskDataConfidence({
    market: intel.market,
    security: intel.security,
    isNativeSol,
  });

  const riskSignals = intel.risk.reasons.map((reason) => ({
    ...reason,
    message: formatRiskSignalMessage(reason, intel),
  }));

  // Why = concrete caution signals only (meta gaps → confidence, not Why).
  const whySignals = riskSignals.filter((r) => !WHY_META_CODES.has(r.code));

  return {
    level: intel.risk.level,
    summary: summarizeRiskAssessment(
      intel.risk.level,
      whySignals,
      positiveSignals,
      { holdersStatus: intel.security.holdersStatus },
    ),
    positiveSignals,
    riskSignals: whySignals,
    dataConfidence,
  };
}
