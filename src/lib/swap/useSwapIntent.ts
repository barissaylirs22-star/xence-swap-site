import { useContext } from "react";
import {
  SwapIntentContext,
  type SwapIntentContextValue,
} from "./swap-intent-context";

export function useSwapIntent(): SwapIntentContextValue {
  const ctx = useContext(SwapIntentContext);
  if (!ctx) {
    throw new Error("useSwapIntent must be used within SwapIntentProvider");
  }
  return ctx;
}
