import { useQuery } from "@tanstack/react-query";
import { isLaunchLive } from "@/config/launch";
import { ONCHAIN_REFETCH_MS, ONCHAIN_STALE_MS } from "@/config/providers";
import {
  emptyOnChainWithError,
  fetchLiveOnChainFacts,
} from "@/lib/solana/rpc";
import { EMPTY_ONCHAIN } from "@/types/token";

/** Enabled only after LAUNCH.isLive + mint are set in config/launch.ts */
export function useAxmOnChain() {
  const enabled = isLaunchLive();
  return useQuery({
    queryKey: ["axiom-onchain", enabled],
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return await fetchLiveOnChainFacts(signal);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "On-chain data unavailable";
        return emptyOnChainWithError(message);
      }
    },
    staleTime: ONCHAIN_STALE_MS,
    refetchInterval: enabled ? ONCHAIN_REFETCH_MS : false,
    retry: 1,
    placeholderData: EMPTY_ONCHAIN,
  });
}
