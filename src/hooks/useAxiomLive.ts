import { useEffect, useState } from "react";
import {
  invalidateDexDiscoveryCaches,
  loadAxiomLiveTabs,
  type AxiomLiveTab,
} from "@/lib/tokens/live";

const EMPTY_TABS: AxiomLiveTab[] = [
  { id: "trending", title: "Trending", tokens: [], unavailable: true },
  { id: "new", title: "New", tokens: [], unavailable: true },
  { id: "high_volume", title: "High Volume", tokens: [], unavailable: true },
  { id: "most_holders", title: "Most Holders", tokens: [], unavailable: true },
  { id: "low_risk", title: "Low Risk", tokens: [], unavailable: true },
  { id: "axm_score", title: "AXM Score", tokens: [], unavailable: true },
  { id: "early_signals", title: "Early Signals", tokens: [], unavailable: true },
  { id: "pump", title: "Pump.fun", tokens: [], unavailable: false },
];

/** Align with Dex discovery TTL — soft refresh keeps Trending/New current. */
const REFRESH_MS = 45_000;

/** Prefetch + refresh Trending/New discovery (Pump.fun uses the realtime stream). */
export function useAxiomLive() {
  const [tabs, setTabs] = useState<AxiomLiveTab[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let controller = new AbortController();

    const load = (mode: "initial" | "refresh") => {
      controller.abort();
      controller = new AbortController();
      const signal = controller.signal;

      const applyForThisLoad = (next: AxiomLiveTab[]) => {
        if (cancelled || signal.aborted) return;
        setTabs(next);
        setLoading(false);
      };

      if (mode === "refresh") {
        invalidateDexDiscoveryCaches();
      } else {
        setLoading(true);
      }

      void loadAxiomLiveTabs(signal, applyForThisLoad)
        .then((next) => {
          applyForThisLoad(next);
        })
        .catch(() => {
          if (!cancelled && !signal.aborted) {
            if (mode === "initial") setTabs(EMPTY_TABS);
            setLoading(false);
          }
        });
    };

    load("initial");
    const timer = window.setInterval(() => load("refresh"), REFRESH_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  return { tabs, loading };
}
