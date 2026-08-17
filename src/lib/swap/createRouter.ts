import { canExecuteSwaps, canFetchQuotes } from "./gate";
import { SwapError } from "./errors";
import { JupiterSwapRouter } from "./jupiter/router";
import type { SwapRouter } from "./types";

let router: SwapRouter | null = null;

function ensureRouter(): SwapRouter {
  if (!router) router = new JupiterSwapRouter();
  return router;
}

/** Router for quotes — independent of AXM launch status. */
export function getSwapRouter(): SwapRouter | null {
  if (!canFetchQuotes()) return null;
  return ensureRouter();
}

export function requireSwapRouter(): SwapRouter {
  const active = getSwapRouter();
  if (!active) {
    throw new SwapError("gated", "Quotes are unavailable right now.");
  }
  return active;
}

/** Router only when execution is enabled for this build. */
export function requireExecutionRouter(): SwapRouter {
  if (!canExecuteSwaps()) {
    throw new SwapError("gated", "Swaps are not enabled yet.");
  }
  return ensureRouter();
}
