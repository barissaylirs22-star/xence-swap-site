/**
 * Compatibility re-exports — prefer `@/lib/tokens/*` for new code.
 */
export {
  SOL_MINT,
  USDC_MINT,
  SOL_TOKEN,
  USDC_TOKEN,
  getDefaultPayToken,
  getDefaultReceiveToken,
} from "@/lib/tokens/catalog";

export {
  getAxmComingSoonToken,
  getAxmLiveToken,
  getAxmDiscoveryEntry,
} from "@/lib/tokens/axm";

import type { SwapPair } from "./types";
import {
  getDefaultPayToken,
  getDefaultReceiveToken,
} from "@/lib/tokens/catalog";

/** Default development pair: SOL ↔ USDC (no AXM mint required). */
export function getDefaultSwapPair(): SwapPair {
  return {
    base: getDefaultPayToken(),
    quote: getDefaultReceiveToken(),
  };
}
