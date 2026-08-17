import type { TokenAsset } from "@/lib/tokens/types";

/** Connection UI states for the Pump.fun realtime feed. */
export type PumpFeedStatus = "connecting" | "live" | "reconnecting" | "fallback";

export type PumpFeedMode = "realtime" | "fallback";

export interface PumpNewTokenEvent {
  mint: string;
  symbol: string;
  name: string;
  creator?: string | null;
  iconUrl?: string | null;
  uri?: string | null;
  /** Epoch ms when the client observed the create event (or fallback ingest). */
  launchedAt: number;
  source: string;
}

export interface PumpLaunchToken extends TokenAsset {
  creator?: string | null;
  launchedAt: number;
  streamSource: PumpFeedMode;
}

export type PumpRealtimeStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "error";

export interface PumpRealtimeHandlers {
  onToken: (event: PumpNewTokenEvent) => void;
  onStatus: (status: PumpRealtimeStatus) => void;
}

/**
 * Isolated realtime adapter — UI talks to the store, not a specific vendor.
 * Swap providers without changing the panel.
 */
export interface PumpRealtimeProvider {
  readonly id: string;
  connect(handlers: PumpRealtimeHandlers): { disconnect: () => void };
}

export interface PumpFeedSnapshot {
  tokens: PumpLaunchToken[];
  status: PumpFeedStatus;
  mode: PumpFeedMode;
}
