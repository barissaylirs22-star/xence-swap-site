import { fetchPumpFunTokens } from "@/lib/market/dexscreener";
import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import { eventToLaunchToken } from "./mapToken";
import { createPumpRealtimeProvider } from "./providers/createProvider";
import type {
  PumpFeedMode,
  PumpFeedSnapshot,
  PumpLaunchToken,
  PumpNewTokenEvent,
  PumpRealtimeProvider,
  PumpRealtimeStatus,
} from "./types";

const MAX_TOKENS = 25;
const FALLBACK_AFTER_FAILURES = 4;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

function emptySnapshot(): PumpFeedSnapshot {
  return {
    tokens: [],
    status: "connecting",
    mode: "realtime",
  };
}

/**
 * Shared Pump.fun launch feed — one WebSocket per page, multi-subscriber.
 * Discovery only; never used for swap execution / signing.
 */
class PumpFunStreamStore {
  private listeners = new Set<() => void>();
  private refCount = 0;
  private snapshot: PumpFeedSnapshot = emptySnapshot();
  private seen = new Set<string>();
  private provider: PumpRealtimeProvider | null = null;
  private session: { disconnect: () => void } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private stopped = true;
  private fallbackLoading = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.refCount += 1;
    if (this.refCount === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) this.stop();
    };
  };

  getSnapshot = (): PumpFeedSnapshot => this.snapshot;

  getServerSnapshot = (): PumpFeedSnapshot => emptySnapshot();

  private emit(
    partial: Partial<PumpFeedSnapshot> & {
      tokens?: PumpLaunchToken[];
    },
  ) {
    this.snapshot = {
      tokens: partial.tokens ?? this.snapshot.tokens,
      status: partial.status ?? this.snapshot.status,
      mode: partial.mode ?? this.snapshot.mode,
    };
    for (const listener of this.listeners) listener();
  }

  private start() {
    this.stopped = false;
    this.failures = 0;
    this.provider = createPumpRealtimeProvider();
    this.connect();
  }

  private stop() {
    this.stopped = true;
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.session?.disconnect();
    this.session = null;
    this.provider = null;
    this.seen.clear();
    this.snapshot = emptySnapshot();
  }

  private connect() {
    if (this.stopped || !this.provider) return;

    this.session?.disconnect();
    this.session = this.provider.connect({
      onToken: (event) => this.handleToken(event, "realtime"),
      onStatus: (status) => this.handleProviderStatus(status),
    });
  }

  private handleToken(event: PumpNewTokenEvent, mode: PumpFeedMode) {
    if (!looksLikeMintAddress(event.mint)) return;
    if (this.seen.has(event.mint)) return;
    this.seen.add(event.mint);

    const next = eventToLaunchToken(event, mode);
    const tokens = [next, ...this.snapshot.tokens].slice(0, MAX_TOKENS);

    // Bound the seen set with the visible window.
    if (this.seen.size > MAX_TOKENS * 2) {
      this.seen = new Set(tokens.map((t) => t.mint));
    }

    this.emit({
      tokens,
      mode,
      status: mode === "realtime" ? "live" : "fallback",
    });
  }

  private handleProviderStatus(status: PumpRealtimeStatus) {
    if (this.stopped) return;

    if (status === "connecting") {
      if (this.snapshot.mode !== "fallback") {
        this.emit({
          status: this.failures > 0 ? "reconnecting" : "connecting",
        });
      }
      return;
    }

    if (status === "live") {
      this.failures = 0;
      // Drop fallback rows so discovery data is never labeled as realtime.
      if (this.snapshot.mode === "fallback") {
        this.seen.clear();
        this.emit({ status: "live", mode: "realtime", tokens: [] });
      } else {
        this.emit({ status: "live", mode: "realtime" });
      }
      return;
    }

    if (status === "closed" || status === "error") {
      this.failures += 1;
      this.session = null;

      if (this.failures >= FALLBACK_AFTER_FAILURES) {
        void this.enterFallback();
      } else if (this.snapshot.mode !== "fallback") {
        this.emit({ status: "reconnecting" });
      }

      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    if (this.reconnectTimer != null) clearTimeout(this.reconnectTimer);

    const exp = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** Math.min(this.failures - 1, 5),
    );
    const jitter = Math.floor(Math.random() * 250);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, exp + jitter);
  }

  private async enterFallback() {
    if (this.stopped || this.fallbackLoading) return;
    this.fallbackLoading = true;
    this.emit({ status: "fallback", mode: "fallback" });

    try {
      const remote = await fetchPumpFunTokens();
      if (this.stopped) return;
      if (!remote || remote.length === 0) {
        this.emit({ status: "fallback", mode: "fallback", tokens: [] });
        return;
      }

      const now = Date.now();
      const mapped: PumpLaunchToken[] = [];
      for (const token of remote) {
        if (!looksLikeMintAddress(token.mint) || this.seen.has(token.mint)) {
          continue;
        }
        this.seen.add(token.mint);
        mapped.push({
          ...token,
          verified: false,
          warnings: Array.from(
            new Set([...(token.warnings ?? []), "unverified" as const]),
          ),
          isFresh: true,
          launchedAt: now,
          creator: null,
          streamSource: "fallback",
        });
        if (mapped.length >= MAX_TOKENS) break;
      }

      // Fallback replaces the buffer so we never label stale discovery as live.
      this.emit({
        status: "fallback",
        mode: "fallback",
        tokens: mapped,
      });
    } catch {
      if (!this.stopped) {
        this.emit({ status: "fallback", mode: "fallback" });
      }
    } finally {
      this.fallbackLoading = false;
    }
  }
}

export const pumpFunStreamStore = new PumpFunStreamStore();
