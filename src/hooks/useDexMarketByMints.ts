import { useEffect, useMemo, useState } from "react";
import {
  fetchDexMarketByMints,
  type DexMarketMetrics,
} from "@/lib/market/dexscreener";

const REFRESH_MS = 30_000;

function metricsHasValue(m: DexMarketMetrics | undefined): boolean {
  if (!m) return false;
  return (
    (m.priceUsd != null && Number.isFinite(m.priceUsd)) ||
    (m.volume24hUsd != null && Number.isFinite(m.volume24hUsd)) ||
    (m.liquidityUsd != null && Number.isFinite(m.liquidityUsd)) ||
    (m.marketCapUsd != null && Number.isFinite(m.marketCapUsd)) ||
    (m.fdvUsd != null && Number.isFinite(m.fdvUsd)) ||
    (m.priceChange5mPct != null && Number.isFinite(m.priceChange5mPct)) ||
    (m.priceChange1hPct != null && Number.isFinite(m.priceChange1hPct)) ||
    (m.priceChange24hPct != null && Number.isFinite(m.priceChange24hPct))
  );
}

/**
 * Overlay DexScreener pair metrics onto Pump (or any) mint list.
 * Does not invent values — missing pairs simply omit metrics.
 */
export function useDexMarketByMints(mints: string[]) {
  const key = useMemo(() => mints.filter(Boolean).join(","), [mints]);
  const [byMint, setByMint] = useState<Map<string, DexMarketMetrics>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!key) {
      setByMint(new Map());
      return;
    }

    const list = key.split(",").filter(Boolean);
    let cancelled = false;
    let loadGen = 0;

    const load = () => {
      const controller = new AbortController();
      const gen = ++loadGen;
      void fetchDexMarketByMints(list, controller.signal)
        .then((next) => {
          if (cancelled || gen !== loadGen) return;
          setByMint((prev) => {
            const merged = new Map<string, DexMarketMetrics>();
            for (const mint of list) {
              const incoming = next.get(mint);
              const prior = prev.get(mint);
              // Keep last known good metrics when a refresh returns empty/malformed.
              if (metricsHasValue(incoming)) {
                merged.set(mint, incoming!);
              } else if (metricsHasValue(prior)) {
                merged.set(mint, prior!);
              } else if (incoming) {
                merged.set(mint, incoming);
              }
            }
            return merged;
          });
        })
        .catch(() => {
          // Soft failure — retain prior overlay metrics.
        });
      return controller;
    };

    let active = load();
    const timer = window.setInterval(() => {
      active.abort();
      active = load();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      active.abort();
      window.clearInterval(timer);
    };
  }, [key]);

  return byMint;
}
