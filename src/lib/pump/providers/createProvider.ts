import {
  createPumpPortalProvider,
  PUMPPORTAL_DEFAULT_WS,
} from "./pumpportal";
import type { PumpRealtimeProvider } from "../types";

/**
 * Build the active realtime provider.
 * Prefer an optional same-origin / proxy WebSocket URL from env (no secrets).
 */
export function createPumpRealtimeProvider(): PumpRealtimeProvider {
  const configured = import.meta.env.VITE_PUMP_WS_URL?.trim();
  const url = configured && configured.length > 0 ? configured : PUMPPORTAL_DEFAULT_WS;
  return createPumpPortalProvider(url);
}
