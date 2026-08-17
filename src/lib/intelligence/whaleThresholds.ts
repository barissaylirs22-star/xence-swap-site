/**
 * Whale Activity significance — adaptive, explainable thresholds.
 * USD alone never qualifies an event; supply / wallet / holder role matter.
 */

/** Absolute dust floor when USD is known — never surface below this without material supply/wallet move. */
export const WHALE_USD_DUST_FLOOR = 100;

/** Legacy named constants (major supply still used by risk). */
export const WHALE_SUPPLY_SIGNIFICANT_PCT = 0.5;
export const WHALE_SUPPLY_MAJOR_PCT = 1.0;
export const WHALE_USD_SIGNIFICANT = 5_000;
export const WHALE_USD_MAJOR = 25_000;

export type TokenSizeTier = "micro" | "small" | "mid" | "large";

export interface WhaleMarketContext {
  liquidityUsd: number | null;
  marketCapUsd: number | null;
}

export interface WhaleSignificanceInput {
  supplyPct: number;
  /** % of the wallet's pre-tx token balance moved (0–100). */
  walletBalancePct: number | null;
  usdValue: number | null;
  isTopHolder: boolean;
  isTop10: boolean;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  /** Confirmed swap vs transfer — used only for ranking boosts, not to bypass filters. */
  isSwap?: boolean;
  kindHint?: "buy" | "sell" | "other";
}

export interface WhaleSignificanceResult {
  significant: boolean;
  major: boolean;
  /** Only major / high-rank events should drive Risk Analysis warnings. */
  riskRelevant: boolean;
  rank: number;
  tier: TokenSizeTier;
  reason: string;
}

export function resolveTokenSizeTier(
  liquidityUsd: number | null,
  marketCapUsd: number | null,
): TokenSizeTier {
  const liq =
    liquidityUsd != null && Number.isFinite(liquidityUsd) ? liquidityUsd : null;
  const mcap =
    marketCapUsd != null && Number.isFinite(marketCapUsd) ? marketCapUsd : null;

  if ((liq != null && liq >= 1_000_000) || (mcap != null && mcap >= 50_000_000)) {
    return "large";
  }
  if ((liq != null && liq >= 100_000) || (mcap != null && mcap >= 5_000_000)) {
    return "mid";
  }
  if ((liq != null && liq >= 10_000) || (mcap != null && mcap >= 500_000)) {
    return "small";
  }
  return "micro";
}

/**
 * Adaptive floors by tier.
 * USD floor is a necessary (not sufficient) gate when USD is known,
 * unless supply or wallet-balance significance is high.
 */
export function tierThresholds(tier: TokenSizeTier): {
  usdFloor: number;
  usdMajor: number;
  supplySignificantPct: number;
  supplyMajorPct: number;
  /** Top-holder wallet balance Δ % that can qualify at lower USD. */
  topHolderWalletPct: number;
  top10WalletPct: number;
  /** Hard reject: USD below this AND weak supply/wallet → filter out. */
  dustUsd: number;
} {
  switch (tier) {
    case "large":
      return {
        usdFloor: 25_000,
        usdMajor: 100_000,
        supplySignificantPct: 0.5,
        supplyMajorPct: 1.0,
        topHolderWalletPct: 15,
        top10WalletPct: 25,
        dustUsd: 1_000,
      };
    case "mid":
      return {
        usdFloor: 5_000,
        usdMajor: 25_000,
        supplySignificantPct: 0.5,
        supplyMajorPct: 1.0,
        topHolderWalletPct: 12,
        top10WalletPct: 20,
        dustUsd: 500,
      };
    case "small":
      return {
        usdFloor: 1_000,
        usdMajor: 5_000,
        supplySignificantPct: 0.35,
        supplyMajorPct: 0.75,
        topHolderWalletPct: 8,
        top10WalletPct: 15,
        dustUsd: 150,
      };
    case "micro":
    default:
      return {
        usdFloor: 200,
        usdMajor: 1_000,
        supplySignificantPct: 0.25,
        supplyMajorPct: 0.75,
        topHolderWalletPct: 5,
        top10WalletPct: 10,
        dustUsd: WHALE_USD_DUST_FLOOR,
      };
  }
}

/**
 * Explainable significance classifier.
 * Returns significant=false for ordinary micro-swaps on established tokens.
 */
export function classifyWhaleSignificance(
  input: WhaleSignificanceInput,
): WhaleSignificanceResult {
  const supplyPct = Number.isFinite(input.supplyPct) ? input.supplyPct : 0;
  const walletPct =
    input.walletBalancePct != null && Number.isFinite(input.walletBalancePct)
      ? Math.max(0, input.walletBalancePct)
      : null;
  const usd =
    input.usdValue != null && Number.isFinite(input.usdValue)
      ? Math.max(0, input.usdValue)
      : null;

  const tier = resolveTokenSizeTier(input.liquidityUsd, input.marketCapUsd);
  const t = tierThresholds(tier);

  const supplySignificant = supplyPct >= t.supplySignificantPct;
  const supplyMajor = supplyPct >= t.supplyMajorPct;
  const usdSignificant = usd != null && usd >= t.usdFloor;
  const usdMajor = usd != null && usd >= t.usdMajor;

  const topHolderMaterial =
    input.isTopHolder &&
    ((walletPct != null && walletPct >= t.topHolderWalletPct) ||
      supplyPct >= t.supplySignificantPct * 0.5);
  const top10Material =
    input.isTop10 &&
    ((walletPct != null && walletPct >= t.top10WalletPct) ||
      supplyPct >= t.supplySignificantPct * 0.75);

  // Hard dust filter: tiny USD with no material supply/wallet move.
  if (usd != null && usd < t.dustUsd) {
    const materialDespiteDust =
      supplySignificant ||
      supplyMajor ||
      (walletPct != null && walletPct >= Math.max(t.topHolderWalletPct, 10)) ||
      (input.isTopHolder &&
        walletPct != null &&
        walletPct >= t.topHolderWalletPct &&
        supplyPct >= 0.1);
    if (!materialDespiteDust) {
      return {
        significant: false,
        major: false,
        riskRelevant: false,
        rank: 0,
        tier,
        reason: `dust_usd_below_${t.dustUsd}`,
      };
    }
  }

  // When USD is known, require either USD floor OR strong supply/wallet evidence.
  // When USD unknown, require supply or material top-holder wallet move.
  let significant = false;
  let reason = "none";

  if (supplyMajor || usdMajor) {
    significant = true;
    reason = supplyMajor ? "supply_major" : "usd_major";
  } else if (supplySignificant) {
    // Supply significance alone is enough (including micro-cap low-USD cases).
    significant = true;
    reason = "supply_significant";
  } else if (usdSignificant && (supplyPct >= 0.05 || topHolderMaterial || top10Material)) {
    // USD floor alone is not enough — need some on-chain size signal.
    significant = true;
    reason = "usd_floor_plus_size_signal";
  } else if (topHolderMaterial && (usd == null || usd >= t.dustUsd * 0.5)) {
    significant = true;
    reason = "top_holder_wallet_move";
  } else if (
    top10Material &&
    supplyPct >= t.supplySignificantPct * 0.4 &&
    (usd == null || usd >= t.dustUsd)
  ) {
    significant = true;
    reason = "top10_wallet_plus_supply";
  }

  const major =
    significant &&
    (supplyMajor ||
      usdMajor ||
      (input.isTopHolder &&
        (supplySignificant ||
          (walletPct != null && walletPct >= t.topHolderWalletPct * 1.5))));

  // Risk only for major moves or top-holder sells/distributions of material size.
  const riskRelevant =
    significant &&
    (major ||
      (input.isTopHolder &&
        (supplySignificant ||
          (walletPct != null && walletPct >= t.topHolderWalletPct))) ||
      supplyPct >= WHALE_SUPPLY_MAJOR_PCT);

  // Rank: importance first, light recency handled by caller if needed.
  let rank = 0;
  if (!significant) {
    return {
      significant: false,
      major: false,
      riskRelevant: false,
      rank: 0,
      tier,
      reason,
    };
  }

  rank += supplyPct * 25;
  if (usd != null) rank += Math.log1p(usd) * 2.2;
  if (walletPct != null) rank += Math.min(walletPct, 100) * 0.35;
  if (input.isTopHolder) rank += 28;
  else if (input.isTop10) rank += 14;
  if (major) rank += 18;
  if (input.kindHint === "sell" && input.isTopHolder) rank += 22;
  if (input.kindHint === "buy" && (input.isTopHolder || input.isTop10)) rank += 14;
  if (input.isSwap) rank += 4;
  if (tier === "large") rank += 2;

  return {
    significant: true,
    major,
    riskRelevant,
    rank,
    tier,
    reason,
  };
}

/**
 * Candidate gate for aggregation pools.
 * Includes fully significant events plus near-miss fragments that can become
 * significant when summed — without admitting ordinary micro-flow (quiet tokens).
 */
export function isWhaleAggregationCandidate(
  input: WhaleSignificanceInput,
): { accept: boolean; scored: WhaleSignificanceResult } {
  const scored = classifyWhaleSignificance(input);
  if (scored.significant) {
    return { accept: true, scored };
  }
  if (scored.reason.startsWith("dust_")) {
    return { accept: false, scored };
  }

  const supplyPct = Number.isFinite(input.supplyPct) ? input.supplyPct : 0;
  const walletPct =
    input.walletBalancePct != null && Number.isFinite(input.walletBalancePct)
      ? Math.max(0, input.walletBalancePct)
      : null;
  const usd =
    input.usdValue != null && Number.isFinite(input.usdValue)
      ? Math.max(0, input.usdValue)
      : null;

  const tier = resolveTokenSizeTier(input.liquidityUsd, input.marketCapUsd);
  const t = tierThresholds(tier);

  // Near-miss: close to supply significance.
  if (supplyPct >= t.supplySignificantPct * 0.75) {
    return { accept: true, scored };
  }

  // Near-miss: ≥75% of tier USD floor plus a real size signal.
  if (
    usd != null &&
    usd >= t.usdFloor * 0.75 &&
    (supplyPct >= 0.05 ||
      input.isTopHolder ||
      input.isTop10 ||
      (walletPct != null && walletPct >= t.top10WalletPct * 0.5))
  ) {
    return { accept: true, scored };
  }

  // Near-miss: top holder moving a material wallet slice (below full significance).
  if (
    input.isTopHolder &&
    walletPct != null &&
    walletPct >= t.topHolderWalletPct * 0.75 &&
    (usd == null || usd >= t.dustUsd * 2)
  ) {
    return { accept: true, scored };
  }

  return { accept: false, scored };
}
