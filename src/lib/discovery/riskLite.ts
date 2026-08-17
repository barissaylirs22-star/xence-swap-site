import {
  RISK_TOP10_HIGH_PCT,
  RISK_TOP10_MEDIUM_PCT,
  RISK_TOP_HOLDER_HIGH_PCT,
  RISK_TOP_HOLDER_MEDIUM_PCT,
  RISK_VERY_LOW_LIQUIDITY_USD,
  RISK_VERY_NEW_MS,
} from "@/lib/intelligence/risk";
import type { RiskLevel } from "@/lib/intelligence/types";
import type { TokenAsset } from "@/lib/tokens/types";

/**
 * Lightweight discovery risk from market + optional concentration.
 * Does not call mint-authority RPC. Never invents missing holder stats.
 * Aligns thresholds with Risk V1 where the same inputs are available.
 */
export function assessDiscoveryRiskLite(input: {
  token: TokenAsset;
  topHolderPct: number | null;
  top10HolderPct: number | null;
  now?: number;
}): { level: RiskLevel; reasons: string[] } {
  const { token, topHolderPct, top10HolderPct } = input;
  const now = input.now ?? Date.now();
  const reasons: string[] = [];
  let high = false;
  let medium = false;

  const liq = token.liquidityUsd;
  const ageMs =
    token.listedAt != null && Number.isFinite(token.listedAt)
      ? now - token.listedAt
      : null;

  if (liq != null && Number.isFinite(liq) && liq < RISK_VERY_LOW_LIQUIDITY_USD) {
    reasons.push("very_low_liquidity");
    medium = true;
    if (ageMs != null && ageMs < RISK_VERY_NEW_MS && liq < RISK_VERY_LOW_LIQUIDITY_USD / 2) {
      high = true;
    }
  }

  if (ageMs != null && ageMs < RISK_VERY_NEW_MS) {
    reasons.push("very_new_token");
    medium = true;
  }

  if (topHolderPct != null && Number.isFinite(topHolderPct)) {
    if (topHolderPct >= RISK_TOP_HOLDER_HIGH_PCT) {
      reasons.push("high_holder_concentration");
      high = true;
    } else if (topHolderPct >= RISK_TOP_HOLDER_MEDIUM_PCT) {
      reasons.push("high_holder_concentration");
      medium = true;
    }
  }

  if (top10HolderPct != null && Number.isFinite(top10HolderPct)) {
    if (top10HolderPct >= RISK_TOP10_HIGH_PCT) {
      reasons.push("high_top10_concentration");
      high = true;
    } else if (top10HolderPct >= RISK_TOP10_MEDIUM_PCT) {
      reasons.push("high_top10_concentration");
      medium = true;
    }
  }

  const hasMarket =
    (liq != null && Number.isFinite(liq)) ||
    (token.volume24hUsd != null && Number.isFinite(token.volume24hUsd));
  const hasHolders =
    (topHolderPct != null && Number.isFinite(topHolderPct)) ||
    (top10HolderPct != null && Number.isFinite(top10HolderPct));

  if (!hasMarket && !hasHolders) {
    return { level: "UNKNOWN", reasons: ["insufficient_data"] };
  }

  if (high) return { level: "HIGH", reasons };
  if (medium) return { level: "MEDIUM", reasons };

  // Confirmed LOW only when concentration was measured and controls look clean
  // on available market signals (no active mint/freeze check in lite path).
  if (
    hasHolders &&
    hasMarket &&
    (liq == null || liq >= RISK_VERY_LOW_LIQUIDITY_USD) &&
    (ageMs == null || ageMs >= RISK_VERY_NEW_MS)
  ) {
    return { level: "LOW", reasons: [] };
  }

  return { level: "UNKNOWN", reasons: ["insufficient_data"] };
}
