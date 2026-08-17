import { SWAP_COPY } from "@/content/swap";
import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";
import type { ConnectedWallet } from "@/lib/wallet/types";
import { canExecuteSwaps, canFetchQuotes } from "./gate";
import { isQuoteFresh } from "./quoteFreshness";
import { validatePayAmount } from "./spendable";
import type { SwapQuote } from "./types";

export type SwapReadinessBlocker =
  | "execution_disabled"
  | "quotes_disabled"
  | "wallet_disconnected"
  | "wallet_cannot_sign"
  | "invalid_pay_mint"
  | "invalid_receive_mint"
  | "invalid_decimals"
  | "unsupported_token"
  | "invalid_amount"
  | "insufficient_balance"
  | "sol_reserve"
  | "balance_unknown"
  | "no_quote"
  | "stale_quote"
  | "quoting"
  | "invalid_min_out"
  | "same_token";

export interface SwapReadinessInput {
  wallet: ConnectedWallet | null;
  payToken: TokenAsset;
  receiveToken: TokenAsset;
  payAmount: string;
  payBalanceUi: number | null;
  quote: SwapQuote | null;
  quoting: boolean;
  quoteError: string | null;
}

export interface SwapReadiness {
  /** True only when every pre-execution condition passes (and execution flag is on). */
  executable: boolean;
  /** Fresh quote + valid inputs; execution may still be gated off. */
  quoteReady: boolean;
  blockers: SwapReadinessBlocker[];
  publicMessage: string | null;
}

function messageFor(blocker: SwapReadinessBlocker): string {
  switch (blocker) {
    case "execution_disabled":
      return SWAP_COPY.swapDisabled;
    case "quotes_disabled":
      return SWAP_COPY.quoteUnavailable;
    case "wallet_disconnected":
      return SWAP_COPY.disconnected;
    case "wallet_cannot_sign":
      return SWAP_COPY.walletCannotSign;
    case "invalid_pay_mint":
    case "invalid_receive_mint":
    case "unsupported_token":
    case "invalid_decimals":
      return SWAP_COPY.unsupportedToken;
    case "invalid_amount":
      return SWAP_COPY.invalidAmount;
    case "insufficient_balance":
      return SWAP_COPY.insufficient;
    case "sol_reserve":
      return SWAP_COPY.solReserve;
    case "balance_unknown":
      return SWAP_COPY.balanceUnavailable;
    case "no_quote":
    case "invalid_min_out":
    case "same_token":
      return SWAP_COPY.quoteUnavailable;
    case "stale_quote":
      return SWAP_COPY.staleQuote;
    case "quoting":
      return SWAP_COPY.quoting;
    default:
      return SWAP_COPY.failure;
  }
}

/**
 * Fail-closed pre-execution checklist.
 * Safe while executionEnabled is false — reports blockers without sending.
 */
export function assessSwapReadiness(input: SwapReadinessInput): SwapReadiness {
  const blockers: SwapReadinessBlocker[] = [];

  if (!canFetchQuotes()) blockers.push("quotes_disabled");
  if (!canExecuteSwaps()) blockers.push("execution_disabled");

  if (!input.wallet) {
    blockers.push("wallet_disconnected");
  } else if (
    !input.wallet.signTransaction &&
    !input.wallet.signAndSendTransaction
  ) {
    blockers.push("wallet_cannot_sign");
  }

  if (!looksLikeMintAddress(input.payToken.mint)) {
    blockers.push("invalid_pay_mint");
  }
  if (!looksLikeMintAddress(input.receiveToken.mint)) {
    blockers.push("invalid_receive_mint");
  }
  if (
    !input.payToken.selectable ||
    !input.receiveToken.selectable ||
    input.payToken.warnings?.includes("coming_soon") ||
    input.receiveToken.warnings?.includes("coming_soon")
  ) {
    blockers.push("unsupported_token");
  }
  if (input.payToken.decimals === null || input.receiveToken.decimals === null) {
    blockers.push("invalid_decimals");
  }
  if (
    input.payToken.mint &&
    input.receiveToken.mint &&
    input.payToken.mint === input.receiveToken.mint
  ) {
    blockers.push("same_token");
  }

  const amount = validatePayAmount({
    amount: input.payAmount,
    token: input.payToken,
    balanceUi: input.payBalanceUi,
    walletConnected: Boolean(input.wallet),
  });

  const hasAmountIntent = input.payAmount.trim().length > 0;

  if (hasAmountIntent && !amount.ok) {
    if (amount.issue === "insufficient") blockers.push("insufficient_balance");
    else if (amount.issue === "sol_reserve") blockers.push("sol_reserve");
    else if (amount.issue === "balance_unknown") blockers.push("balance_unknown");
    else if (amount.issue !== "empty") blockers.push("invalid_amount");
  }

  if (input.quoting) blockers.push("quoting");

  if (hasAmountIntent && amount.ok) {
    if (input.quoting) {
      /* quoting already recorded */
    } else if (!input.quote) {
      blockers.push("no_quote");
    } else {
      if (!isQuoteFresh(input.quote)) blockers.push("stale_quote");
      if (
        !/^\d+$/.test(input.quote.minOutAmountRaw) ||
        input.quote.minOutAmountRaw === "0" ||
        !/^\d+$/.test(input.quote.outAmountRaw) ||
        input.quote.outAmountRaw === "0"
      ) {
        blockers.push("invalid_min_out");
      }
      if (
        input.quote.inputMint !== input.payToken.mint ||
        input.quote.outputMint !== input.receiveToken.mint
      ) {
        blockers.push("no_quote");
      }
    }
    if (input.quoteError && !input.quoting && !input.quote) {
      blockers.push("no_quote");
    }
  }

  const unique = Array.from(new Set(blockers));

  const soft = new Set<SwapReadinessBlocker>([
    "execution_disabled",
    "wallet_disconnected",
    "wallet_cannot_sign",
  ]);

  const quoteReady =
    amount.ok &&
    Boolean(input.quote) &&
    isQuoteFresh(input.quote) &&
    !input.quoting &&
    !unique.some((b) => !soft.has(b));

  // executable requires zero blockers including execution flag.
  const executable = unique.length === 0;

  const priority: SwapReadinessBlocker[] = [
    "wallet_disconnected",
    "insufficient_balance",
    "sol_reserve",
    "balance_unknown",
    "invalid_amount",
    "unsupported_token",
    "invalid_decimals",
    "invalid_pay_mint",
    "invalid_receive_mint",
    "same_token",
    "stale_quote",
    "quoting",
    "no_quote",
    "invalid_min_out",
    "quotes_disabled",
    "wallet_cannot_sign",
    "execution_disabled",
  ];

  const primary =
    priority.find((b) => unique.includes(b)) ?? unique[0] ?? null;

  // Only surface execution_disabled once the quote path itself is ready.
  let publicMessage: string | null = null;
  if (primary === "execution_disabled") {
    publicMessage = quoteReady ? messageFor("execution_disabled") : null;
  } else if (primary && primary !== "wallet_disconnected") {
    publicMessage = messageFor(primary);
  } else if (primary === "wallet_disconnected" && !hasAmountIntent) {
    publicMessage = messageFor("wallet_disconnected");
  } else if (primary) {
    publicMessage = messageFor(primary);
  }

  return {
    executable,
    quoteReady,
    blockers: unique,
    publicMessage,
  };
}
