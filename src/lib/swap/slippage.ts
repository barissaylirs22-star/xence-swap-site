import {
  DEFAULT_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  MIN_SLIPPAGE_BPS,
} from "@/config/providers";

/** Clamp slippage into a safe BPS range. Invalid input → default. */
export function clampSlippageBps(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SLIPPAGE_BPS;
  const rounded = Math.round(n);
  if (rounded < MIN_SLIPPAGE_BPS || rounded > MAX_SLIPPAGE_BPS) {
    return Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, rounded));
  }
  return rounded;
}

export function isValidSlippageBps(value: unknown): boolean {
  const n = typeof value === "number" ? value : Number(value);
  return (
    Number.isFinite(n) &&
    Number.isInteger(n) &&
    n >= MIN_SLIPPAGE_BPS &&
    n <= MAX_SLIPPAGE_BPS
  );
}

/**
 * Parse a user slippage percent string into BPS.
 * Rejects malformed / out-of-range values (returns null — do not clamp silently).
 */
export function parseSlippagePercentInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/%/g, "");
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const pct = Number(cleaned);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const bps = Math.round(pct * 100);
  if (!isValidSlippageBps(bps)) return null;
  return bps;
}
