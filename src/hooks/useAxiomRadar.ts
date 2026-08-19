import { useEffect, useMemo, useRef } from "react";
import { useAxiomLive } from "@/hooks/useAxiomLive";
import { useDiscoveryEnrichment } from "@/hooks/useDiscoveryEnrichment";
import { useClock } from "@/hooks/useClock";
import {
  deriveRadarEvents,
  snapshotRadarPriors,
  type RadarEvent,
  type RadarPriorMetrics,
} from "@/lib/discovery/radarEvents";
import type { TokenAsset } from "@/lib/tokens/types";

export type RadarFeedStatus =
  | "loading"
  | "ready"
  | "empty"
  | "unavailable"
  | "degraded";

export interface AxiomRadarState {
  events: RadarEvent[];
  status: RadarFeedStatus;
  /** Tokens in the shared discovery universe. */
  observedCount: number;
  /** Enrichment entries that reached ready. */
  enrichedReadyCount: number;
  /** Enrichment still loading. */
  enriching: boolean;
  /** Resolve Token Detail from Radar event mint (existing universe rows). */
  tokensByMint: Map<string, TokenAsset>;
}

/**
 * AXIOM RADAR feed over the shared discovery universe.
 * Reuses Live discovery + enrichment caches — no universe-wide whale RPC.
 */
export function useAxiomRadar(): AxiomRadarState {
  const { tabs, loading } = useAxiomLive();
  const now = useClock(true);
  const priorRef = useRef<Map<string, RadarPriorMetrics>>(new Map());

  const universe = useMemo(() => {
    const trending = tabs.find((t) => t.id === "trending");
    return trending?.tokens ?? tabs[0]?.tokens ?? [];
  }, [tabs]);

  const universeUnavailable = useMemo(() => {
    const trending = tabs.find((t) => t.id === "trending");
    return Boolean(trending?.unavailable);
  }, [tabs]);

  const tokensByMint = useMemo(() => {
    const map = new Map<string, TokenAsset>();
    for (const t of universe) {
      if (t.mint) map.set(t.mint, t);
    }
    return map;
  }, [universe]);

  const enrichment = useDiscoveryEnrichment(
    universe,
    universe.length > 0 && !universeUnavailable,
  );

  const events = useMemo(() => {
    if (universeUnavailable || universe.length === 0) return [];
    return deriveRadarEvents(universe, enrichment, {
      priorByMint: priorRef.current,
      now,
    });
  }, [universe, enrichment, now, universeUnavailable]);

  // Update session baselines AFTER this paint so liquidity moves can compare
  // against the previous refresh — never treated as durable history.
  useEffect(() => {
    if (universe.length === 0) return;
    priorRef.current = snapshotRadarPriors(universe, Date.now());
  }, [universe]);

  const enrichedReadyCount = useMemo(() => {
    let n = 0;
    for (const e of enrichment.values()) {
      if (e.status === "ready") n += 1;
    }
    return n;
  }, [enrichment]);

  const enriching = useMemo(() => {
    for (const e of enrichment.values()) {
      if (e.status === "loading") return true;
    }
    return false;
  }, [enrichment]);

  let status: RadarFeedStatus;
  if (loading && universe.length === 0) {
    status = "loading";
  } else if (universeUnavailable) {
    status = "unavailable";
  } else if (events.length === 0 && enriching && enrichedReadyCount === 0) {
    status = "loading";
  } else if (events.length === 0 && enrichedReadyCount === 0 && !enriching) {
    status = "degraded";
  } else if (events.length === 0) {
    status = "empty";
  } else {
    status = "ready";
  }

  return {
    events,
    status,
    observedCount: universe.length,
    enrichedReadyCount,
    enriching,
    tokensByMint,
  };
}
