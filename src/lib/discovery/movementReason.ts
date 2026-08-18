/**
 * Compact movement reason for AXIOM LIVE rows.
 * Uses the same real Dex fields that feed trendingScore — never invents signals.
 * Returns null when no threshold is clearly met.
 */

import type { TokenAsset } from "@/lib/tokens/types";

/** Align with trendingScore freshness window (partial). */
const NEW_MS = 6 * 60 * 60 * 1000;

/** 24h volume (USD) — strong standalone “high volume”. */
const VOL_HIGH_USD = 100_000;
/** 24h volume enough to pair with momentum. */
const VOL_WITH_MOMENTUM_USD = 25_000;
/** Liquidity (USD) — deep book. */
const LIQ_DEEP_USD = 100_000;
/** |5m %| momentum. */
const CH5_MOMENTUM_PCT = 8;
/** |1h %| momentum. */
const CH1H_MOMENTUM_PCT = 15;
/** Softer bars when combined with “new”. */
const CH5_NEW_MOVE_PCT = 5;
const CH1H_NEW_MOVE_PCT = 8;
const VOL_NEW_MOVE_USD = 10_000;

export type MovementReasonId =
  | "volume_momentum"
  | "high_volume"
  | "momentum_5m"
  | "momentum_1h"
  | "new_moving"
  | "deep_liquidity";

export interface MovementReason {
  id: MovementReasonId;
  /** Short scan label for the row. */
  label: string;
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

/**
 * Deterministic movement reason from existing discovery metrics.
 * Prefer reasons that match trendingScore drivers (vol → momentum → freshness → liq).
 * Do not change trendingScore — display aid only.
 */
export function deriveMovementReason(
  token: TokenAsset,
  now = Date.now(),
): MovementReason | null {
  const vol = finite(token.volume24hUsd) ? token.volume24hUsd : null;
  const liq = finite(token.liquidityUsd) ? token.liquidityUsd : null;
  const ch5 = finite(token.priceChange5mPct) ? token.priceChange5mPct : null;
  const ch1h = finite(token.priceChange1hPct) ? token.priceChange1hPct : null;

  const ageMs =
    token.listedAt != null && Number.isFinite(token.listedAt)
      ? Math.max(0, now - token.listedAt)
      : null;
  const isNew =
    (ageMs != null && ageMs < NEW_MS) ||
    (token.isFresh === true && ageMs != null && ageMs < 72 * 60 * 60 * 1000);

  const hot5 = ch5 != null && Math.abs(ch5) >= CH5_MOMENTUM_PCT;
  const hot1h = ch1h != null && Math.abs(ch1h) >= CH1H_MOMENTUM_PCT;
  const mildMove =
    (ch5 != null && Math.abs(ch5) >= CH5_NEW_MOVE_PCT) ||
    (ch1h != null && Math.abs(ch1h) >= CH1H_NEW_MOVE_PCT) ||
    (vol != null && vol >= VOL_NEW_MOVE_USD);

  // Priority mirrors trendingScore emphasis: volume, then momentum, then new, then liq.
  if (
    vol != null &&
    vol >= VOL_WITH_MOMENTUM_USD &&
    (hot5 || hot1h)
  ) {
    return { id: "volume_momentum", label: "VOLUME + MOMENTUM" };
  }

  if (vol != null && vol >= VOL_HIGH_USD) {
    return { id: "high_volume", label: "HIGH VOLUME" };
  }

  if (hot5) {
    return { id: "momentum_5m", label: "5M MOMENTUM" };
  }

  if (hot1h) {
    return { id: "momentum_1h", label: "1H MOMENTUM" };
  }

  if (isNew && mildMove) {
    return { id: "new_moving", label: "NEW + MOVING" };
  }

  if (liq != null && liq >= LIQ_DEEP_USD) {
    return { id: "deep_liquidity", label: "DEEP LIQUIDITY" };
  }

  return null;
}
