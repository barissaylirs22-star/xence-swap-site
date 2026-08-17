import { useSyncExternalStore } from "react";
import { pumpFunStreamStore } from "@/lib/pump/streamStore";
import type { PumpFeedSnapshot } from "@/lib/pump/types";

/** Shared Pump.fun realtime feed (one WebSocket for the page). */
export function usePumpFunStream(): PumpFeedSnapshot {
  return useSyncExternalStore(
    pumpFunStreamStore.subscribe,
    pumpFunStreamStore.getSnapshot,
    pumpFunStreamStore.getServerSnapshot,
  );
}
