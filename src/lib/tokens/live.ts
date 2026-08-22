import {
  DISCOVERY_TARGET,
  fetchDiscoveryUniverse,
  invalidateDexDiscoveryCaches as invalidateDex,
} from "@/lib/market/dexscreener";
import type { TokenAsset } from "./types";

export type AxiomLiveTabId =
  | "trending"
  | "new"
  | "high_volume"
  | "most_holders"
  | "low_risk"
  | "axm_score"
  | "early_signals"
  | "pump";

export interface AxiomLiveTab {
  id: AxiomLiveTabId;
  title: string;
  tokens: TokenAsset[];
  unavailable?: boolean;
}

export function invalidateDexDiscoveryCaches(): void {
  invalidateDex();
}

function tabsFromUniverse(
  universe: TokenAsset[] | null,
): AxiomLiveTab[] {
  const tokens: TokenAsset[] = universe ?? [];
  const unavailable = universe === null;

  return [
    { id: "trending", title: "Trending", tokens, unavailable },
    { id: "new", title: "New", tokens, unavailable },
    { id: "high_volume", title: "High Volume", tokens, unavailable },
    { id: "most_holders", title: "Most Holders", tokens, unavailable },
    { id: "low_risk", title: "Low Risk", tokens, unavailable },
    { id: "axm_score", title: "AXM Score", tokens, unavailable },
    { id: "early_signals", title: "Early Signals", tokens, unavailable },
    { id: "pump", title: "Pump.fun", tokens: [], unavailable: false },
  ];
}

/**
 * Load the shared discovery universe for AXIOM LIVE filters.
 * Pump.fun remains a separate realtime stream.
 *
 * `onPartial` receives the same tab shape after each Dex mint-enrich batch so
 * the panel can show first usable rows before the final capped universe.
 */
export async function loadAxiomLiveTabs(
  signal?: AbortSignal,
  onPartial?: (tabs: AxiomLiveTab[]) => void,
): Promise<AxiomLiveTab[]> {
  const universe = await fetchDiscoveryUniverse(
    signal,
    DISCOVERY_TARGET,
    onPartial
      ? (tokens) => {
          onPartial(tabsFromUniverse(tokens));
        }
      : undefined,
  ).catch(() => null);

  return tabsFromUniverse(universe);
}
