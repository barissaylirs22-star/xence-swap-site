import { getActiveMint, isLaunchLive } from "@/config/launch";
import { SWAP_FEATURES } from "@/config/swap";
import { SwapError } from "./errors";

/** AXM project token is live and mint is configured. */
export function isAxmLive(): boolean {
  return isLaunchLive() && Boolean(getActiveMint());
}

/** General swap terminal UI (token pickers, balances, search). */
export function isSwapTerminalEnabled(): boolean {
  return SWAP_FEATURES.terminalEnabled === true;
}

/** Real quote requests may run for supported pairs. */
export function canFetchQuotes(): boolean {
  return isSwapTerminalEnabled() && SWAP_FEATURES.quotesEnabled === true;
}

/** Real swap execution (build + wallet sign/send). Off during this pass. */
export function canExecuteSwaps(): boolean {
  return isSwapTerminalEnabled() && SWAP_FEATURES.executionEnabled === true;
}

export function assertCanFetchQuotes(): void {
  if (!canFetchQuotes()) {
    throw new SwapError("gated", "Quotes are unavailable right now.");
  }
}

export function assertCanExecuteSwaps(): void {
  if (!canExecuteSwaps()) {
    throw new SwapError(
      "gated",
      "Swaps are not enabled yet.",
    );
  }
}

/** @deprecated Use isAxmLive / canFetchQuotes / canExecuteSwaps */
export function canTrade(): boolean {
  return isAxmLive();
}
