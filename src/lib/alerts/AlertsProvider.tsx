import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  clearAlertEvents,
  followToken,
  isFollowed,
  markAlertRead,
  markAllAlertsRead,
  unfollowToken,
  unreadAlertCount,
  type AlertEvent,
  type FollowedToken,
} from "@/lib/alerts";
import {
  AlertsContext,
  emitEvents,
  emitWatchlist,
  getEventsSnapshot,
  getWatchlistSnapshot,
  subscribeEvents,
  subscribeWatchlist,
  type AlertsContextValue,
  type DetailAlertFeed,
} from "./AlertsContext";

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
