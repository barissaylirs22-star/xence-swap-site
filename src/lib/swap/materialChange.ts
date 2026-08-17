import type { SwapQuote } from "./types";

/** True when a refreshed quote differs enough that the user must re-confirm. */
export function isMaterialQuoteChange(
  previous: SwapQuote,
  next: SwapQuote,
): boolean {
  if (previous.inputMint !== next.inputMint) return true;
  if (previous.outputMint !== next.outputMint) return true;
  if (previous.inAmountRaw !== next.inAmountRaw) return true;
  if (previous.slippageBps !== next.slippageBps) return true;
  if (previous.routeSummary !== next.routeSummary) return true;

  try {
    const prevOut = BigInt(previous.outAmountRaw);
    const nextOut = BigInt(next.outAmountRaw);
    const prevMin = BigInt(previous.minOutAmountRaw);
    const nextMin = BigInt(next.minOutAmountRaw);

    if (prevOut === 0n || prevMin === 0n) return true;

    const outDiff = prevOut > nextOut ? prevOut - nextOut : nextOut - prevOut;
    const minDiff = prevMin > nextMin ? prevMin - nextMin : nextMin - prevMin;

    // > 0.5% move in expected out or minimum received → re-confirm.
    if ((outDiff * 10_000n) / prevOut > 50n) return true;
    if ((minDiff * 10_000n) / prevMin > 50n) return true;
  } catch {
    return true;
  }

  return false;
}
