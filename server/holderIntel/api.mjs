/**
 * Holder Intelligence HTTP handler — shared by Vite middleware and CF Worker.
 */
import {
  applyObservation,
  buildIntelFromSeries,
  isValidMint,
  normalizeObservation,
  isUsableObservation,
} from "./core.mjs";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 60;

function emptyIntelBody() {
  return {
    growth: {
      available: false,
      building: true,
      currentCount: null,
      deltas: [],
      primaryLine: null,
      recordedMs: null,
      statusLine: "Building history…",
    },
    whale: {
      available: false,
      building: true,
      largestTrend: null,
      top10Trend: null,
      largestDeltaPp: null,
      top10DeltaPp: null,
      comparedAt: null,
      preferredWindow: null,
      windows: [],
      signals: [],
      recordedMs: null,
      statusLine: "Building history…",
    },
    interpretations: [],
    recordedMs: null,
    snapshotCount: 0,
    lastSnapshotAt: null,
    persisted: false,
  };
}

/**
 * @param {{ getSeries: Function, updateSeries: Function }} store
 * @param {{ getClientId?: (req: any) => string, allowBackdate?: boolean }} options
 */
export function createHolderIntelHandler(store, options = {}) {
  const hits = new Map();
  const allowBackdate = Boolean(options.allowBackdate);

  function rateLimitOk(clientId) {
    const now = Date.now();
    const bucket = hits.get(clientId) ?? [];
    const recent = bucket.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX_PER_WINDOW) {
      hits.set(clientId, recent);
      return false;
    }
    recent.push(now);
    hits.set(clientId, recent);
    return true;
  }

  /**
   * POST body: { mint, observation: { holderCount, topHolderPct, top10HolderPct, priceUsd?, liquidityUsd?, marketCapUsd? } }
   * GET query: ?mint=...  (read-only history + build from latest stored, no write)
   */
  async function handle({ method, bodyText, mintQuery, clientId }) {
    const id = clientId || "anon";
    if (!rateLimitOk(id)) {
      return {
        status: 429,
        body: { error: "Too many requests" },
      };
    }

    if (method === "GET") {
      const mint = (mintQuery ?? "").trim();
      if (!isValidMint(mint)) {
        return { status: 400, body: { error: "Invalid mint" } };
      }
      const series = await store.getSeries(mint);
      const latest = series[series.length - 1] ?? null;
      if (!latest) {
        return {
          status: 200,
          body: {
            mint,
            snapshots: [],
            intel: emptyIntelBody(),
          },
        };
      }
      const historical = series.slice(0, -1);
      const intel = buildIntelFromSeries(historical, latest, {
        wrote: false,
        snapshotCount: series.length,
      });
      return {
        status: 200,
        body: {
          mint,
          snapshots: series,
          intel,
        },
      };
    }

    if (method !== "POST") {
      return { status: 405, body: { error: "Method not allowed" } };
    }

    let parsed;
    try {
      parsed = JSON.parse(bodyText || "{}");
    } catch {
      return { status: 400, body: { error: "Invalid JSON" } };
    }

    const mint = typeof parsed.mint === "string" ? parsed.mint.trim() : "";
    if (!isValidMint(mint)) {
      return { status: 400, body: { error: "Invalid mint" } };
    }

    const now = Date.now();
    let obsTime = now;
    if (
      allowBackdate &&
      parsed.observation &&
      typeof parsed.observation.t === "number" &&
      Number.isFinite(parsed.observation.t) &&
      parsed.observation.t <= now &&
      parsed.observation.t > now - 48 * 60 * 60 * 1000
    ) {
      obsTime = parsed.observation.t;
    }
    const currentObs = normalizeObservation(parsed.observation ?? {}, obsTime);

    if (!isUsableObservation(currentObs)) {
      return {
        status: 200,
        body: {
          mint,
          intel: emptyIntelBody(),
        },
      };
    }

    const { series, meta } = await store.updateSeries(mint, (existing, tNow) => {
      const before = existing.slice();
      const applied = applyObservation(before, currentObs, tNow);
      return {
        series: applied.series,
        meta: {
          wrote: applied.wrote,
          beforeCount: before.length,
          historical: applied.series.filter((s) => s.t < currentObs.t),
        },
      };
    });

    const historical =
      meta.historical ?? series.filter((s) => s.t < currentObs.t);

    const intel = buildIntelFromSeries(historical, currentObs, {
      wrote: meta.wrote,
      snapshotCount: series.length,
    });

    return {
      status: 200,
      body: {
        mint,
        intel,
        persisted: Boolean(meta.wrote),
        snapshotCount: series.length,
      },
    };
  }

  return { handle };
}
