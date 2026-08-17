import type { SwapQuote } from "./types";

/** True when a quote is still within its freshness window. */
export function isQuoteFresh(
  quote: SwapQuote | null | undefined,
  now = Date.now(),
): boolean {
  if (!quote) return false;
  if (!Number.isFinite(quote.quotedAt) || !Number.isFinite(quote.expiresAt)) {
    return false;
  }
  if (quote.expiresAt <= quote.quotedAt) return false;
  return now < quote.expiresAt;
}

/** Fail closed before any future transaction build/sign path. */
export function assertQuoteFresh(quote: SwapQuote, now = Date.now()): void {
  if (!isQuoteFresh(quote, now)) {
    throw new Error("stale_quote");
  }
}
