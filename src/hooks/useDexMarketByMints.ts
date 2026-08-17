import { useEffect, useMemo, useState } from "react";
import {
  fetchDexMarketByMints,
  type DexMarketMetrics,
} from "@/lib/market/dexscreener";

const REFRESH_MS = 30_000;

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
    const controller = new AbortController();

    const load = () => {
      void fetchDexMarketByMints(list, controller.signal).then((next) => {
        if (!cancelled && !controller.signal.aborted) setByMint(next);
      });
    };

    load();
    const timer = window.setInterval(load, REFRESH_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [key]);

  return byMint;
}
