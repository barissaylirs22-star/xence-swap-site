import type { PumpFeedMode, PumpLaunchToken, PumpNewTokenEvent } from "./types";

/** Pump.fun SPL tokens use 6 decimals on-chain — used only to assist quoting. */
const PUMP_DECIMALS = 6;

export function eventToLaunchToken(
  event: PumpNewTokenEvent,
  streamSource: PumpFeedMode,
): PumpLaunchToken {
  return {
    mint: event.mint,
    symbol: event.symbol,
    name: event.name,
    decimals: PUMP_DECIMALS,
    iconUrl: event.iconUrl ?? null,
    metadataUri: event.uri ?? null,
    verified: false,
    selectable: true,
    warnings: ["unverified"],
    isFresh: true,
    creator: event.creator ?? null,
    launchedAt: event.launchedAt,
    streamSource,
  };
}

export function formatLaunchAge(launchedAt: number, now = Date.now()): string {
  const delta = Math.max(0, Math.floor((now - launchedAt) / 1000));
  if (delta < 2) return "JUST NOW";
  if (delta < 60) return `${delta}s`;
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

export function shortKey(value: string | null | undefined): string {
  if (!value || value.length < 8) return value || "—";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
