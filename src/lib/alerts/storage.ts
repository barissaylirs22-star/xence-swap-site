/**
 * Alerts V1 localStorage helpers — watchlist, events, arm/baseline state.
 * Zero network. Bounded event history.
 */

import {
  ALERT_MAX_EVENTS,
  type AlertArmMap,
  type AlertArmState,
  type AlertEvent,
  type AlertPriority,
  type AlertType,
  type FollowedToken,
  alertArmKey,
} from "./types";

const WATCHLIST_KEY = "axiom:watchlist:v1";
const EVENTS_KEY = "axiom:alerts:events:v1";
const ARMS_KEY = "axiom:alerts:arms:v1";

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota / private mode — ignore; in-memory callers still work for session.
  }
}

function isFollowedToken(v: unknown): v is FollowedToken {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.mint === "string" && o.mint.length > 0 && typeof o.createdAt === "number";
}

function isAlertEvent(v: unknown): v is AlertEvent {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.mint === "string" &&
    typeof o.type === "string" &&
    typeof o.priority === "string" &&
    typeof o.reason === "string" &&
    typeof o.createdAt === "number" &&
    typeof o.read === "boolean"
  );
}

function isArmState(v: unknown): v is AlertArmState {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.baselined === "boolean" &&
    typeof o.active === "boolean" &&
    (o.lastFiredAt === null || typeof o.lastFiredAt === "number")
  );
}

/** Cap at 50: drop oldest INFORMATIONAL first, then oldest overall. */
export function trimAlertEvents(events: AlertEvent[]): AlertEvent[] {
  if (events.length <= ALERT_MAX_EVENTS) return events;
  const sorted = [...events].sort((a, b) => a.createdAt - b.createdAt);
  const next = [...sorted];
  while (next.length > ALERT_MAX_EVENTS) {
    const infoIdx = next.findIndex((e) => e.priority === "INFORMATIONAL");
    if (infoIdx >= 0) {
      next.splice(infoIdx, 1);
    } else {
      next.shift();
    }
  }
  return next;
}

// —— Watchlist ——

export function loadWatchlist(): FollowedToken[] {
  const raw = readJson<unknown[]>(WATCHLIST_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isFollowedToken);
}

export function saveWatchlist(list: FollowedToken[]): void {
  writeJson(WATCHLIST_KEY, list);
}

export function isFollowed(mint: string, list?: FollowedToken[]): boolean {
  const items = list ?? loadWatchlist();
  return items.some((t) => t.mint === mint);
}

export function followToken(input: {
  mint: string;
  symbol?: string;
  name?: string;
  now?: number;
}): FollowedToken[] {
  const list = loadWatchlist();
  if (list.some((t) => t.mint === input.mint)) return list;
  const next: FollowedToken[] = [
    ...list,
    {
      mint: input.mint,
      symbol: input.symbol,
      name: input.name,
      createdAt: input.now ?? Date.now(),
    },
  ];
  saveWatchlist(next);
  return next;
}

export function unfollowToken(mint: string): FollowedToken[] {
  const next = loadWatchlist().filter((t) => t.mint !== mint);
  saveWatchlist(next);
  return next;
}

// —— Events ——

export function loadAlertEvents(): AlertEvent[] {
  const raw = readJson<unknown[]>(EVENTS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return trimAlertEvents(raw.filter(isAlertEvent));
}

export function saveAlertEvents(events: AlertEvent[]): void {
  writeJson(EVENTS_KEY, trimAlertEvents(events));
}

export function appendAlertEvents(
  existing: AlertEvent[],
  incoming: AlertEvent[],
): AlertEvent[] {
  if (incoming.length === 0) return trimAlertEvents(existing);
  const next = trimAlertEvents([...existing, ...incoming]);
  saveAlertEvents(next);
  return next;
}

export function markAlertRead(id: string, events?: AlertEvent[]): AlertEvent[] {
  const list = events ?? loadAlertEvents();
  const next = list.map((e) => (e.id === id ? { ...e, read: true } : e));
  saveAlertEvents(next);
  return next;
}

export function markAllAlertsRead(events?: AlertEvent[]): AlertEvent[] {
  const list = events ?? loadAlertEvents();
  const next = list.map((e) => (e.read ? e : { ...e, read: true }));
  saveAlertEvents(next);
  return next;
}

export function clearAlertEvents(): AlertEvent[] {
  saveAlertEvents([]);
  return [];
}

export function unreadAlertCount(events?: AlertEvent[]): number {
  const list = events ?? loadAlertEvents();
  let n = 0;
  for (const e of list) if (!e.read) n += 1;
  return n;
}

// —— Arms / baselines ——

export function loadAlertArms(): AlertArmMap {
  const raw = readJson<Record<string, unknown>>(ARMS_KEY, {});
  if (!raw || typeof raw !== "object") return {};
  const out: AlertArmMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (isArmState(v)) out[k] = v;
  }
  return out;
}

export function saveAlertArms(arms: AlertArmMap): void {
  writeJson(ARMS_KEY, arms);
}

export function getArm(
  arms: AlertArmMap,
  mint: string,
  type: AlertType,
): AlertArmState {
  const key = alertArmKey(mint, type);
  return (
    arms[key] ?? {
      baselined: false,
      active: false,
      lastFiredAt: null,
      lastRiskLevel: null,
    }
  );
}

export function setArm(
  arms: AlertArmMap,
  mint: string,
  type: AlertType,
  state: AlertArmState,
): AlertArmMap {
  return { ...arms, [alertArmKey(mint, type)]: state };
}

/** Test helper — wipe all alert localStorage keys. */
export function resetAlertStorageForTests(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(WATCHLIST_KEY);
    localStorage.removeItem(EVENTS_KEY);
    localStorage.removeItem(ARMS_KEY);
  } catch {
    /* ignore */
  }
}

export type { AlertPriority };
