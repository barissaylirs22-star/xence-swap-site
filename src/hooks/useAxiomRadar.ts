import { useEffect, useMemo, useRef } from "react";
import { useAxiomDiscovery } from "@/lib/discovery/AxiomDiscoveryContext";
import { useClock } from "@/hooks/useClock";
import {
  deriveRadarEvents,
  snapshotRadarPriors,
  type RadarEvent,
  type RadarPriorMetrics,
} from "@/lib/discovery/radarEvents";
import { resolveLiveAxiomScore } from "@/lib/discovery/resolvedAxiomScore";
import type { TokenAsset } from "@/lib/tokens/types";

export type RadarFeedStatus =
  | "loading"
  | "ready"
  | "empty"
  | "unavailable"
  | "degraded";

export interface RadarDisplayEvent extends RadarEvent {
  /** Context-only AXM when already resolvable — never ranks / never fetches. */
  axmScore: number | null;
  axmLabel: string | null;
}

export interface AxiomRadarState {
  events: RadarDisplayEvent[];
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
 * AXIOM RADAR shortlist over the shared Live discovery universe.
 * Reuses Live discovery + enrichment — zero Radar-specific RPC.
 */
export function useAxiomRadar(): AxiomRadarState {
  const {
    universe,
    universeUnavailable,
    enrichment,
    loading,
  } = useAxiomDiscovery();
  const now = useClock(true);
  const priorRef = useRef<Map<string, RadarPriorMetrics>>(new Map());

  const tokensByMint = useMemo(() => {
    const map = new Map<string, TokenAsset>();
    for (const t of universe) {
      if (t.mint) map.set(t.mint, t);
    }
    return map;
  }, [universe]);

  const events = useMemo(() => {
    if (universeUnavailable || universe.length === 0) return [];
    const derived = deriveRadarEvents(universe, enrichment, {
      priorByMint: priorRef.current,
      now,
    });
    return derived.map((ev): RadarDisplayEvent => {
      const token = tokensByMint.get(ev.mint);
      const e = enrichment.get(ev.mint);
      const axm =
        token != null
          ? resolveLiveAxiomScore(token, e ?? null, now)
          : null;
      return {
        ...ev,
        riskLevel: ev.riskLevel ?? e?.riskLevel ?? null,
        axmScore: axm?.score ?? null,
        axmLabel: axm?.label ?? null,
      };
    });
  }, [universe, enrichment, now, universeUnavailable, tokensByMint]);

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
