import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import type {
  PumpNewTokenEvent,
  PumpRealtimeHandlers,
  PumpRealtimeProvider,
} from "../types";

/** Public PumpPortal data socket — no client secret required. */
export const PUMPPORTAL_DEFAULT_WS = "wss://pumpportal.fun/api/data";

interface PumpPortalCreateMessage {
  message?: string;
  txType?: string;
  mint?: string;
  name?: string;
  symbol?: string;
  uri?: string;
  image?: string;
  traderPublicKey?: string;
}

function normalizeIcon(value?: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const lower = value.toLowerCase();
    if (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".webp") ||
      lower.includes("image")
    ) {
      return value;
    }
    // Metadata JSON URIs are not usable logos without an extra fetch.
    return null;
  }
  return null;
}

export function mapPumpPortalMessage(
  data: unknown,
  now = Date.now(),
): PumpNewTokenEvent | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as PumpPortalCreateMessage;
  if (typeof msg.message === "string") return null;
  if (msg.txType && msg.txType !== "create") return null;

  const mint = typeof msg.mint === "string" ? msg.mint.trim() : "";
  if (!looksLikeMintAddress(mint)) return null;

  const symbol = (msg.symbol || mint.slice(0, 4)).trim().slice(0, 16) || "TOKEN";
  const name = (msg.name || "Unknown token").trim().slice(0, 64) || "Unknown token";

  return {
    mint,
    symbol,
    name,
    creator: (() => {
      const creator =
        typeof msg.traderPublicKey === "string" ? msg.traderPublicKey.trim() : "";
      // Same base58 shape as mints; reject junk without treating wallets as tokens.
      return looksLikeMintAddress(creator) ? creator : null;
    })(),
    iconUrl: normalizeIcon(msg.image) || normalizeIcon(msg.uri),
    uri: typeof msg.uri === "string" ? msg.uri : null,
    launchedAt: now,
    source: "pumpportal",
  };
}

/**
 * PumpPortal WebSocket adapter (discovery only — never used for execution).
 */
export function createPumpPortalProvider(
  url = PUMPPORTAL_DEFAULT_WS,
): PumpRealtimeProvider {
  return {
    id: "pumpportal",
    connect(handlers: PumpRealtimeHandlers) {
      let socket: WebSocket | null = null;
      let closedByUs = false;

      const open = () => {
        handlers.onStatus("connecting");
        try {
          socket = new WebSocket(url);
        } catch {
          handlers.onStatus("error");
          return;
        }

        socket.onopen = () => {
          if (closedByUs) return;
          try {
            socket?.send(JSON.stringify({ method: "subscribeNewToken" }));
            handlers.onStatus("live");
          } catch {
            handlers.onStatus("error");
          }
        };

        socket.onmessage = (event) => {
          if (closedByUs) return;
          try {
            const raw =
              typeof event.data === "string"
                ? event.data
                : String(event.data ?? "");
            const parsed: unknown = JSON.parse(raw);
            const mapped = mapPumpPortalMessage(parsed);
            if (mapped) handlers.onToken(mapped);
          } catch {
            /* ignore malformed frames */
          }
        };

        socket.onerror = () => {
          if (!closedByUs) handlers.onStatus("error");
        };

        socket.onclose = () => {
          if (!closedByUs) handlers.onStatus("closed");
        };
      };

      open();

      return {
        disconnect: () => {
          closedByUs = true;
          try {
            socket?.close();
          } catch {
            /* ignore */
          }
          socket = null;
          handlers.onStatus("closed");
        },
      };
    },
  };
}
