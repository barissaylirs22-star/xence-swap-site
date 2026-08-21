import { useEffect, useRef, useState } from "react";
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

function universeTokenCount(tabs: AxiomLiveTab[]): number {
  const trending = tabs.find((t) => t.id === "trending");
  return trending?.tokens.length ?? 0;
}

/** Real discovery rows present — not an empty/unavailable placeholder. */
function hasUsableUniverse(tabs: AxiomLiveTab[]): boolean {
  const trending = tabs.find((t) => t.id === "trending");
  return Boolean(
    trending &&
      !trending.unavailable &&
      Array.isArray(trending.tokens) &&
      trending.tokens.length > 0,
  );
}

/** Tokens that still carry at least one real market field. */
function metricsTokenCount(tabs: AxiomLiveTab[]): number {
  const tokens = tabs.find((t) => t.id === "trending")?.tokens ?? [];
  return tokens.filter(
    (t) =>
      (t.priceUsd != null && Number.isFinite(t.priceUsd)) ||
      (t.volume24hUsd != null && Number.isFinite(t.volume24hUsd)) ||
      (t.liquidityUsd != null && Number.isFinite(t.liquidityUsd)),
  ).length;
}

/** Prefetch + refresh Trending/New discovery (Pump.fun uses the realtime stream). */
export function useAxiomLive() {
  const [tabs, setTabs] = useState<AxiomLiveTab[]>([]);
  const [loading, setLoading] = useState(true);
  const lastGoodRef = useRef<AxiomLiveTab[] | null>(null);
  const loadGenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let controller = new AbortController();

    const applyTabs = (
      next: AxiomLiveTab[],
      mode: "initial" | "refresh",
      gen: number,
      isPartial: boolean,
    ) => {
      if (cancelled || gen !== loadGenRef.current) return;

      if (!hasUsableUniverse(next)) {
        // Preserve last known good during short refresh / partial failures.
        if (lastGoodRef.current) {
          if (import.meta.env.DEV) {
            console.info(
              "[axiom-live] keeping prior universe after empty/unavailable response",
              { mode, isPartial },
            );
          }
          setLoading(false);
          return;
        }
        if (!isPartial) {
          setTabs(next.length > 0 ? next : EMPTY_TABS);
          setLoading(false);
        }
        return;
      }

      // Soft refresh: ignore incomplete batches so the list does not shrink/reorder mid-fetch.
      if (mode === "refresh" && isPartial && lastGoodRef.current) {
        const prevCount = universeTokenCount(lastGoodRef.current);
        const nextCount = universeTokenCount(next);
        if (nextCount < prevCount) return;
      }

      // Soft refresh: reject clearly degraded enrich (e.g. all metrics null) vs prior good set.
      if (mode === "refresh" && !isPartial && lastGoodRef.current) {
        const prevMetrics = metricsTokenCount(lastGoodRef.current);
        const nextMetrics = metricsTokenCount(next);
        if (
          prevMetrics >= 8 &&
          nextMetrics < Math.max(3, Math.floor(prevMetrics * 0.25))
        ) {
          if (import.meta.env.DEV) {
            console.info(
              "[axiom-live] keeping prior universe after degraded metrics response",
              { prevMetrics, nextMetrics },
            );
          }
          setLoading(false);
          return;
        }
      }

      lastGoodRef.current = next;
      setTabs(next);
      setLoading(false);
    };

    const load = (mode: "initial" | "refresh") => {
      controller.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const gen = ++loadGenRef.current;

      if (mode === "refresh") {
        invalidateDexDiscoveryCaches();
      } else {
        setLoading(true);
      }

      // Progressive paint only on first load — refresh applies the final set to avoid row thrash.
      const onPartial =
        mode === "initial"
          ? (partial: AxiomLiveTab[]) => {
              if (signal.aborted) return;
              applyTabs(partial, mode, gen, true);
            }
          : undefined;

      void loadAxiomLiveTabs(signal, onPartial)
        .then((next) => {
          if (signal.aborted || gen !== loadGenRef.current) return;
          applyTabs(next, mode, gen, false);
        })
        .catch((err) => {
          if (cancelled || signal.aborted || gen !== loadGenRef.current) return;
          if (import.meta.env.DEV) {
            console.info("[axiom-live] discovery load failed", {
              mode,
              reason: err instanceof Error ? err.message : "unknown",
            });
          }
          if (!lastGoodRef.current) {
            setTabs(EMPTY_TABS);
          }
          setLoading(false);
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
