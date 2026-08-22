import { useEffect, useRef } from "react";
import { useAlerts } from "@/lib/alerts/AlertsContext";
import type { AlertEvent, AlertPriority } from "@/lib/alerts";
import styles from "./AlertsPanel.module.css";

function priorityClass(p: AlertPriority): string {
  if (p === "CRITICAL") return styles.priorityCritical;
  if (p === "IMPORTANT") return styles.priorityImportant;
  return styles.priorityInfo;
}

function priorityLabel(p: AlertPriority): string {
  if (p === "CRITICAL") return "Critical";
  if (p === "IMPORTANT") return "Important";
  return "Info";
}

function formatRelative(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function tokenLabel(ev: AlertEvent): string {
  return ev.symbol || ev.name || `${ev.mint.slice(0, 4)}…`;
}

export function AlertsControl() {
  const {
    unreadCount,
    panelOpen,
    setPanelOpen,
    events,
    markRead,
    markAllRead,
    clearHistory,
  } = useAlerts();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [panelOpen, setPanelOpen]);

  const now = Date.now();
  const sorted = [...events].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={
          unreadCount > 0
            ? `Alerts, ${unreadCount} unread`
            : "Alerts"
        }
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen(!panelOpen)}
      >
        <svg
          className={styles.icon}
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm8-6V11a8 8 0 1 0-16 0v5l-1.4 1.4c-.6.6-.2 1.6.7 1.6h17.4c.9 0 1.3-1 .7-1.6L20 16Z"
          />
        </svg>
        {unreadCount > 0 ? (
          <span className={styles.badge}>{unreadCount > 9 ? "9+" : unreadCount}</span>
        ) : null}
      </button>

      {panelOpen ? (
        <div className={styles.panel} role="dialog" aria-label="Alerts">
          <div className={styles.panelHead}>
            <div>
              <div className={styles.panelTitle}>Alerts</div>
              <p className={styles.panelHelp}>
                Important changes from tokens you follow.
              </p>
            </div>
            <button
              type="button"
              className={styles.iconClose}
              aria-label="Close alerts"
              onClick={() => setPanelOpen(false)}
            >
              ×
            </button>
          </div>

          {sorted.length > 0 ? (
            <div className={styles.toolbar}>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={markAllRead}
                disabled={unreadCount === 0}
              >
                Mark all read
              </button>
              <button
                type="button"
                className={styles.toolBtn}
                onClick={clearHistory}
              >
                Clear
              </button>
            </div>
          ) : null}

          <div className={styles.list}>
            {sorted.length === 0 ? (
              <p className={styles.empty}>
                No important changes detected for followed tokens yet.
              </p>
            ) : (
              sorted.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className={[
                    styles.item,
                    ev.read ? styles.itemRead : styles.itemUnread,
                  ].join(" ")}
                  onClick={() => {
                    if (!ev.read) markRead(ev.id);
                  }}
                >
                  <div className={styles.itemTop}>
                    <span className={styles.itemToken}>{tokenLabel(ev)}</span>
                    <span
                      className={[
                        styles.priority,
                        priorityClass(ev.priority),
                      ].join(" ")}
                    >
                      {priorityLabel(ev.priority)}
                    </span>
                    <span className={styles.itemTime}>
                      {formatRelative(ev.createdAt, now)}
                    </span>
                  </div>
                  <p className={styles.itemReason}>{ev.reason}</p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
