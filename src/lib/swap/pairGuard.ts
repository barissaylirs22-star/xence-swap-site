import type { TokenAsset } from "@/lib/tokens/types";
import { SwapError } from "./errors";
import { isQuoteFresh } from "./quoteFreshness";
import type { SwapQuote } from "./types";

/** Fail closed if the live quote does not match the displayed pair/amount. */
export function assertQuoteMatchesPair(options: {
  quote: SwapQuote;
  payToken: TokenAsset;
  receiveToken: TokenAsset;
  payAmountRaw: string;
}): void {
  const { quote, payToken, receiveToken, payAmountRaw } = options;

  if (!isQuoteFresh(quote)) {
    throw new SwapError(
      "stale_quote",
      "Quote expired. Request a fresh quote and try again.",
    );
  }

  if (
    quote.inputMint !== payToken.mint ||
    quote.outputMint !== receiveToken.mint
  ) {
    throw new SwapError(
      "invalid_request",
      "Token pair changed. Request a fresh quote.",
    );
  }

  if (quote.inAmountRaw !== payAmountRaw) {
    throw new SwapError(
      "invalid_request",
      "Amount changed. Request a fresh quote.",
    );
  }
}

export function quoteMatchesDisplayedPair(
  quote: SwapQuote | null,
  payMint: string,
  receiveMint: string,
): boolean {
  if (!quote) return false;
  return quote.inputMint === payMint && quote.outputMint === receiveMint;
}
