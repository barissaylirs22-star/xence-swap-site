import { createContext, useContext } from "react";
import type { DiscoveryEnrichment } from "@/lib/discovery/filters";
import type { AxiomLiveTab } from "@/lib/tokens/live";
import type { TokenAsset } from "@/lib/tokens/types";

export interface AxiomDiscoveryState {
  tabs: AxiomLiveTab[];
  loading: boolean;
  universe: TokenAsset[];
  universeUnavailable: boolean;
  enrichment: Map<string, DiscoveryEnrichment>;
}

export const AxiomDiscoveryContext =
  createContext<AxiomDiscoveryState | null>(null);

export function useAxiomDiscovery(): AxiomDiscoveryState {
  const ctx = useContext(AxiomDiscoveryContext);
  if (!ctx) {
    throw new Error(
      "useAxiomDiscovery must be used within AxiomDiscoveryProvider",
    );
  }
  return ctx;
}
