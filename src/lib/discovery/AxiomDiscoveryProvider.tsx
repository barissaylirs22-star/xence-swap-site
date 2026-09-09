import { useMemo, type ReactNode } from "react";
import { useAxiomLive } from "@/hooks/useAxiomLive";
import { useDiscoveryEnrichment } from "@/hooks/useDiscoveryEnrichment";
import {
  AxiomDiscoveryContext,
  type AxiomDiscoveryState,
} from "./AxiomDiscoveryContext";

/**
 * Single shared Live discovery + enrichment pipeline for AXIOM LIVE and RADAR.
 * One discovery poll + one holder-enrichment queue — Radar adds zero RPC.
 */
export function AxiomDiscoveryProvider({ children }: { children: ReactNode }) {
  const { tabs, loading } = useAxiomLive();

  const universe = useMemo(() => {
    const trending = tabs.find((t) => t.id === "trending");
    return trending?.tokens ?? tabs[0]?.tokens ?? [];
  }, [tabs]);

  const universeUnavailable = useMemo(() => {
    const trending = tabs.find((t) => t.id === "trending");
    return Boolean(trending?.unavailable);
  }, [tabs]);

  const enrichment = useDiscoveryEnrichment(
    universe,
    universe.length > 0 && !universeUnavailable,
  );

  const value = useMemo<AxiomDiscoveryState>(
    () => ({
      tabs,
      loading,
      universe,
      universeUnavailable,
      enrichment,
    }),
    [tabs, loading, universe, universeUnavailable, enrichment],
  );

  return (
    <AxiomDiscoveryContext.Provider value={value}>
      {children}
    </AxiomDiscoveryContext.Provider>
  );
}
