import { createContext } from "react";
import type { TokenAsset } from "@/lib/tokens/types";

export interface SwapLiveIntent {
  token: TokenAsset;
  key: number;
}

export interface SwapIntentContextValue {
  intent: SwapLiveIntent | null;
  selectLiveReceiveToken: (token: TokenAsset) => void;
  consumeIntent: () => void;
}

export const SwapIntentContext =
  createContext<SwapIntentContextValue | null>(null);
