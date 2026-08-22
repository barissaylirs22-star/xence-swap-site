import { useEffect, useMemo, useRef } from "react";
import { useAxiomDiscovery } from "@/lib/discovery/AxiomDiscoveryContext";
import {
  appendAlertEvents,
  evaluateAlerts,
  loadAlertArms,
  loadAlertEvents,
  saveAlertArms,
  type AlertObservation,
} from "@/lib/alerts";
import {
  notifyAlertEventsChanged,
  useAlerts,
} from "@/lib/alerts/AlertsContext";
import {
  snapshotRadarPriors,
  type RadarPriorMetrics,
} from "@/lib/discovery/radarEvents";

/**
 * Opportunistic Alerts evaluation over shared Live discovery + Detail feed.
 * Zero extra RPC / timers — runs when shared observations change.
 */
export function AlertsEvaluator() {
  const { universe, universeUnavailable, enrichment } = useAxiomDiscovery();
  const { followed, detailFeed, refreshEvents } = useAlerts();
  const priorRef = useRef<Map<string, RadarPriorMetrics>>(new Map());
  const armsRef = useRef(loadAlertArms());

  const followedMints = useMemo(
    () => new Set(followed.map((f) => f.mint)),
    [followed],
  );

  const observations = useMemo(() => {
    if (universeUnavailable) return [] as AlertObservation[];
    const out: AlertObservation[] = [];

    for (const token of universe) {
      if (!token.mint || !followedMints.has(token.mint)) continue;
      // Prefer Detail observation when that mint is open — skip Live duplicate.
      if (detailFeed?.mint === token.mint) continue;
      out.push({
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        token,
        enrichment: enrichment.get(token.mint) ?? null,
        riskLevel: enrichment.get(token.mint)?.riskLevel ?? null,
        liquidityUsd: token.liquidityUsd ?? null,
        prior: priorRef.current.get(token.mint) ?? null,
        includeWhale: false,
      });
    }

    if (detailFeed && followedMints.has(detailFeed.mint)) {
      const live = universe.find((t) => t.mint === detailFeed.mint);
      const e = enrichment.get(detailFeed.mint);
      out.push({
        mint: detailFeed.mint,
        symbol: detailFeed.symbol ?? live?.symbol,
        name: detailFeed.name ?? live?.name,
        token: detailFeed.token,
        enrichment: e ?? null,
        riskLevel: detailFeed.riskLevel ?? e?.riskLevel ?? null,
        early: detailFeed.early,
        liquidityUsd:
          detailFeed.token.liquidityUsd ?? live?.liquidityUsd ?? null,
        prior: priorRef.current.get(detailFeed.mint) ?? null,
        includeWhale: detailFeed.whaleReady,
        whaleActivity: detailFeed.whaleActivity,
      });
    }

    return out;
  }, [universe, universeUnavailable, enrichment, followedMints, detailFeed]);

  useEffect(() => {
    if (followed.length === 0) return;
    if (observations.length === 0) return;

    const result = evaluateAlerts({
      followed,
      observations,
      arms: armsRef.current,
      now: Date.now(),
    });

    armsRef.current = result.arms;
    saveAlertArms(result.arms);

    if (result.newEvents.length > 0) {
      appendAlertEvents(loadAlertEvents(), result.newEvents);
      notifyAlertEventsChanged();
      refreshEvents();
    }
  }, [followed, observations, refreshEvents]);

  // Session liquidity priors — same timing as Radar (after paint). Zero RPC.
  useEffect(() => {
    if (universe.length === 0) return;
    priorRef.current = snapshotRadarPriors(universe, Date.now());
  }, [universe]);

  return null;
}
