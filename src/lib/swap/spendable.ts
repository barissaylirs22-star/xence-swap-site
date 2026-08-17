import { SOL_MINT } from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";
import { isPositiveAmount, toRawAmount } from "./amounts";

/**
 * Conservative SOL buffer for fees / priority / ATA rent.
 * Kept small on purpose — not a large idle reserve.
 */
export const SOL_FEE_RESERVE_SOL = 0.01;

export type PayAmountIssue =
  | "empty"
  | "invalid"
  | "zero"
  | "insufficient"
  | "sol_reserve"
  | "balance_unknown";

/** Sanitize decimal amount typing (digits + single dot). */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return (
    cleaned.slice(0, firstDot + 1) +
    cleaned.slice(firstDot + 1).replace(/\./g, "")
  );
}

export function isValidAmountShape(uiAmount: string): boolean {
  const trimmed = uiAmount.trim();
  if (!trimmed) return true;
  return /^(\d+(\.\d+)?|\.\d+)$/.test(trimmed);
}

export function isNativeSolToken(token: TokenAsset): boolean {
  return token.isNativeSol === true || token.mint === SOL_MINT;
}

export function getMaxSpendableUi(
  token: TokenAsset,
  balanceUi: number | null,
): number | null {
  if (balanceUi === null || !Number.isFinite(balanceUi)) return null;
  if (isNativeSolToken(token)) {
    return Math.max(0, balanceUi - SOL_FEE_RESERVE_SOL);
  }
  return Math.max(0, balanceUi);
}

export function validatePayAmount(options: {
  amount: string;
  token: TokenAsset;
  balanceUi: number | null;
  walletConnected: boolean;
}): { ok: true; amount: number } | { ok: false; issue: PayAmountIssue } {
  const trimmed = options.amount.trim();
  if (!trimmed) return { ok: false, issue: "empty" };
  if (!isValidAmountShape(trimmed)) return { ok: false, issue: "invalid" };

  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { ok: false, issue: "invalid" };
  if (n === 0 || !isPositiveAmount(trimmed)) return { ok: false, issue: "zero" };

  if (options.token.decimals === null) {
    return { ok: false, issue: "invalid" };
  }

  // Reject amounts that cannot convert to raw units (too many fraction digits).
  if (toRawAmount(trimmed, options.token.decimals) === null) {
    return { ok: false, issue: "invalid" };
  }

  if (!options.walletConnected) {
    return { ok: true, amount: n };
  }

  if (options.balanceUi === null) {
    return { ok: false, issue: "balance_unknown" };
  }

  if (n > options.balanceUi) {
    return { ok: false, issue: "insufficient" };
  }

  const spendable = getMaxSpendableUi(options.token, options.balanceUi);
  if (spendable !== null && n > spendable) {
    return {
      ok: false,
      issue: isNativeSolToken(options.token) ? "sol_reserve" : "insufficient",
    };
  }

  return { ok: true, amount: n };
}
