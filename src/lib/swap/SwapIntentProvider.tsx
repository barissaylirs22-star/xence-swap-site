import { useCallback, useMemo, useState, type ReactNode } from "react";
import { scrollToTradeSection } from "@/lib/nav/initialScroll";
import type { TokenAsset } from "@/lib/tokens/types";
import {
  SwapIntentContext,
  type SwapLiveIntent,
} from "./swap-intent-context";

export function SwapIntentProvider({ children }: { children: ReactNode }) {
  const [intent, setIntent] = useState<SwapLiveIntent | null>(null);

  const selectLiveReceiveToken = useCallback((token: TokenAsset) => {
    if (!token.selectable || !token.mint) return;
    setIntent({ token, key: Date.now() });
    scrollToTradeSection();
  }, []);

  const consumeIntent = useCallback(() => {
    setIntent(null);
  }, []);

  const value = useMemo(
    () => ({ intent, selectLiveReceiveToken, consumeIntent }),
    [intent, selectLiveReceiveToken, consumeIntent],
  );

  return (
    <SwapIntentContext.Provider value={value}>
      {children}
    </SwapIntentContext.Provider>
  );
}
