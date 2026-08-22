import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EarlySignalResult } from "@/lib/discovery/earlySignals";
import type { RiskLevel, WhaleActivityFacts } from "@/lib/intelligence/types";
import type { TokenAsset } from "@/lib/tokens/types";
import {
  clearAlertEvents,
  followToken,
  isFollowed,
  loadAlertEvents,
  loadWatchlist,
  markAlertRead,
  markAllAlertsRead,
  saveWatchlist,
  unfollowToken,
  unreadAlertCount,
  type AlertEvent,
  type FollowedToken,
} from "@/lib/alerts";

/** Detail-only observation feed for LARGE_HOLDER_DISTRIBUTION (+ richer risk/early). */
export interface DetailAlertFeed {
  mint: string;
  symbol?: string;
  name?: string;
  token: TokenAsset;
  riskLevel: RiskLevel | null;
  early: EarlySignalResult | null;
  whaleActivity: WhaleActivityFacts | null;
  /** Whale section finished loading (success or unavailable). */
  whaleReady: boolean;
}

interface AlertsContextValue {
  followed: FollowedToken[];
  events: AlertEvent[];
  unreadCount: number;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  isFollowing: (mint: string) => boolean;
  follow: (token: { mint: string; symbol?: string; name?: string }) => void;
  unfollow: (mint: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearHistory: () => void;
  detailFeed: DetailAlertFeed | null;
  setDetailFeed: (feed: DetailAlertFeed | null) => void;
  /** Called by evaluator after appending events. */
  refreshEvents: () => void;
}

const AlertsContext = createContext<AlertsContextValue | null>(null);

let watchlistVersion = 0;
const watchlistListeners = new Set<() => void>();
let watchlistSnapshot: FollowedToken[] = [];
let watchlistSnapshotVersion = -1;

function emitWatchlist() {
  watchlistVersion += 1;
  for (const l of watchlistListeners) l();
}

function subscribeWatchlist(cb: () => void) {
  watchlistListeners.add(cb);
  return () => {
    watchlistListeners.delete(cb);
  };
}

function getWatchlistSnapshot(): FollowedToken[] {
  // useSyncExternalStore requires a cached reference when data is unchanged.
  if (watchlistSnapshotVersion !== watchlistVersion) {
    watchlistSnapshotVersion = watchlistVersion;
    watchlistSnapshot = loadWatchlist();
  }
  return watchlistSnapshot;
}

let eventsVersion = 0;
const eventsListeners = new Set<() => void>();
let eventsSnapshot: AlertEvent[] = [];
let eventsSnapshotVersion = -1;

function emitEvents() {
  eventsVersion += 1;
  for (const l of eventsListeners) l();
}

function subscribeEvents(cb: () => void) {
  eventsListeners.add(cb);
  return () => {
    eventsListeners.delete(cb);
  };
}

function getEventsSnapshot(): AlertEvent[] {
  // useSyncExternalStore requires a cached reference when data is unchanged.
  if (eventsSnapshotVersion !== eventsVersion) {
    eventsSnapshotVersion = eventsVersion;
    eventsSnapshot = loadAlertEvents();
  }
  return eventsSnapshot;
}

export function notifyAlertEventsChanged(): void {
  emitEvents();
}

export function AlertsProvider({ children }: { children: ReactNode }) {
  const followed = useSyncExternalStore(
    subscribeWatchlist,
    getWatchlistSnapshot,
    () => [] as FollowedToken[],
  );
  const events = useSyncExternalStore(
    subscribeEvents,
    getEventsSnapshot,
    () => [] as AlertEvent[],
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [detailFeed, setDetailFeed] = useState<DetailAlertFeed | null>(null);

  const unreadCount = useMemo(() => unreadAlertCount(events), [events]);

  const follow = useCallback(
    (token: { mint: string; symbol?: string; name?: string }) => {
      followToken(token);
      emitWatchlist();
    },
    [],
  );

  const unfollow = useCallback((mint: string) => {
    unfollowToken(mint);
    emitWatchlist();
  }, []);

  const markRead = useCallback((id: string) => {
    markAlertRead(id);
    emitEvents();
  }, []);

  const markAllRead = useCallback(() => {
    markAllAlertsRead();
    emitEvents();
  }, []);

  const clearHistory = useCallback(() => {
    clearAlertEvents();
    emitEvents();
  }, []);

  const refreshEvents = useCallback(() => {
    emitEvents();
  }, []);

  const isFollowingFn = useCallback(
    (mint: string) => isFollowed(mint, followed),
    [followed],
  );

  const value = useMemo<AlertsContextValue>(
    () => ({
      followed,
      events,
      unreadCount,
      panelOpen,
      setPanelOpen,
      isFollowing: isFollowingFn,
      follow,
      unfollow,
      markRead,
      markAllRead,
      clearHistory,
      detailFeed,
      setDetailFeed,
      refreshEvents,
    }),
    [
      followed,
      events,
      unreadCount,
      panelOpen,
      isFollowingFn,
      follow,
      unfollow,
      markRead,
      markAllRead,
      clearHistory,
      detailFeed,
      refreshEvents,
    ],
  );

  return (
    <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>
  );
}

export function useAlerts(): AlertsContextValue {
  const ctx = useContext(AlertsContext);
  if (!ctx) {
    throw new Error("useAlerts must be used within AlertsProvider");
  }
  return ctx;
}

/** Optional — Token Detail may render outside provider in tests. */
export function useAlertsOptional(): AlertsContextValue | null {
  return useContext(AlertsContext);
}

/** Replace watchlist in storage and notify (tests / rare resets). */
export function replaceWatchlist(list: FollowedToken[]): void {
  saveWatchlist(list);
  emitWatchlist();
}
