/**
 * Lightweight Axiom Score for AXIOM LIVE rows.
 *
 * Subset / preview of Full Axiom Score (computeAxiomScore):
 * - Same category weights and band thresholds
 * - Holder trend + whale categories always neutral (no history / whale RPC)
 * - Mint/freeze / Jupiter route only when already known (discovery has none → neutral)
 * - Holder concentration only when DiscoveryEnrichment already cached/ready
 *
 * Pure computation from TokenAsset + optional enrichment. No Helius burst.
 */

import {
  classifyAxiomScore,
  computeAxiomScore,
  RISK_VERY_LOW_LIQUIDITY_USD,
  RISK_VERY_NEW_MS,
} from "@/lib/intelligence";
import type {
  AxiomDataConfidence,
  AxiomScoreBand,
  AxiomScoreResult,
  TokenMarketFacts,
  TokenSecurityFacts,
  TokenTradingFacts,
} from "@/lib/intelligence";
import type { TokenAsset } from "@/lib/tokens/types";

/** Subset of DiscoveryEnrichment — avoids circular import with filters.ts */
export interface LightweightScoreEnrichment {
  holderCount: number | null;
  topHolderPct: number | null;
  top10HolderPct: number | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}
export type LightweightAxiomScoreMode = "lightweight";

export interface LightweightAxiomScore {
  mode: LightweightAxiomScoreMode;
  score: number;
  band: AxiomScoreBand;
  label: string;
  confidence: AxiomDataConfidence;
  /** Holder concentration from existing discovery enrichment was applied. */
  usedHolderEnrichment: boolean;
  /** Underlying full-engine result (history/whale neutral). */
  engine: AxiomScoreResult;
  computedAt: number;
}

const cache = new Map<string, LightweightAxiomScore>();
const CACHE_MAX = 400;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fingerprint(
  token: TokenAsset,
  enrichment: LightweightScoreEnrichment | null | undefined,
): string {
  const e = enrichment?.status === "ready" ? enrichment : null;
  return [
    token.mint,
    token.liquidityUsd ?? "",
    token.marketCapUsd ?? "",
    token.fdvUsd ?? "",
    token.volume24hUsd ?? "",
    token.listedAt ?? "",
    token.priceChange5mPct ?? "",
    token.priceChange1hPct ?? "",
    e?.topHolderPct ?? "",
    e?.top10HolderPct ?? "",
    e?.holderCount ?? "",
    e?.status ?? "none",
  ].join("|");
}

function buildMarketFacts(
  token: TokenAsset,
  now: number,
): TokenMarketFacts {
  const listedAt =
    token.listedAt != null && Number.isFinite(token.listedAt)
      ? token.listedAt
      : null;
  const ageMs = listedAt != null ? Math.max(0, now - listedAt) : null;
  const liq = token.liquidityUsd;
  const mcap = token.marketCapUsd;
  const fdv = token.fdvUsd;
  const vol = token.volume24hUsd;
  const available =
    (liq != null && Number.isFinite(liq)) ||
    (mcap != null && Number.isFinite(mcap)) ||
    (fdv != null && Number.isFinite(fdv)) ||
    (vol != null && Number.isFinite(vol));

  return {
    priceUsd: token.priceUsd ?? null,
    marketCapUsd: mcap ?? null,
    fdvUsd: fdv ?? null,
    liquidityUsd: liq ?? null,
    priceChange5mPct: token.priceChange5mPct ?? null,
    priceChange1hPct: token.priceChange1hPct ?? null,
    priceChange24hPct: token.priceChange24hPct ?? null,
    volume24hUsd: vol ?? null,
    listedAt,
    ageMs,
    available,
  };
}

function buildSecurityFacts(
  enrichment: LightweightScoreEnrichment | null | undefined,
): { security: TokenSecurityFacts; usedHolderEnrichment: boolean } {
  const ready = enrichment?.status === "ready";
  const top = ready ? enrichment.topHolderPct : null;
  const top10 = ready ? enrichment.top10HolderPct : null;
  const holders = ready ? enrichment.holderCount : null;
  const concentrationOk =
    (top != null && Number.isFinite(top)) ||
    (top10 != null && Number.isFinite(top10));

  return {
    usedHolderEnrichment: concentrationOk,
    security: {
      mintAuthorityActive: null,
      freezeAuthorityActive: null,
      mintAuthority: null,
      freezeAuthority: null,
      supplyUi: null,
      decimals: null,
      holderCount:
        holders != null && Number.isFinite(holders) ? holders : null,
      topHolderPct: concentrationOk ? top : null,
      top10HolderPct: concentrationOk ? top10 : null,
      authoritiesAvailable: false,
      holdersAvailable: concentrationOk,
      holdersPending: enrichment?.status === "loading",
      holdersStatus: concentrationOk
        ? "ready"
        : enrichment?.status === "loading"
          ? "pending"
          : enrichment?.status === "unavailable"
            ? "unavailable"
            : "idle",
      holdersError: null,
    },
  };
}

function buildTradingFacts(market: TokenMarketFacts): TokenTradingFacts {
  const liq = market.liquidityUsd;
  const liquidityWarning =
    liq != null &&
    Number.isFinite(liq) &&
    liq < RISK_VERY_LOW_LIQUIDITY_USD;
  const veryNewTokenWarning =
    market.ageMs != null && market.ageMs < RISK_VERY_NEW_MS;

  return {
    // Discovery does not probe Jupiter per row.
    routeAvailable: null,
    priceImpactPct: null,
    priceImpactLevel: "unknown",
    liquidityWarning,
    veryNewTokenWarning,
  };
}

/**
 * Discovery-only structural penalties — never rewards green candles.
 * Caps unstable thin markets that the Full score would usually catch via
 * impact / whale / history once Token Detail loads.
 */
function applyStructuralPenalties(
  score: number,
  token: TokenAsset,
): number {
  let next = score;
  const liq = token.liquidityUsd;
  const vol = token.volume24hUsd;
  const absMove = Math.max(
    Math.abs(token.priceChange1hPct ?? 0),
    Math.abs(token.priceChange5mPct ?? 0),
  );

  if (liq != null && Number.isFinite(liq) && liq < 25_000) {
    if (absMove >= 80) next -= 6;
    else if (absMove >= 40) next -= 3;
  }

  if (
    liq != null &&
    Number.isFinite(liq) &&
    liq > 0 &&
    vol != null &&
    Number.isFinite(vol)
  ) {
    const ratio = vol / liq;
    if (ratio >= 40) next -= 4;
    else if (ratio >= 15) next -= 2;
  }

  return clamp(Math.round(next), 0, 100);
}

/**
 * Without holder concentration evidence, LIVE preview must not claim
 * Healthy / Strong Structure (avoids misleading band jumps when enrichment arrives).
 */
export const LIGHTWEIGHT_NO_HOLDERS_SCORE_CAP = 69;

/**
 * Compute lightweight LIVE-row score. Memoized by input fingerprint.
 */
export function computeLightweightAxiomScore(
  token: TokenAsset,
  enrichment?: LightweightScoreEnrichment | null,
  now = Date.now(),
): LightweightAxiomScore | null {
  if (!token.mint || !token.selectable) return null;

  const key = fingerprint(token, enrichment);
  const hit = cache.get(key);
  if (hit) return hit;

  const market = buildMarketFacts(token, now);
  if (!market.available && enrichment?.status !== "ready") {
    return null;
  }

  const { security, usedHolderEnrichment } = buildSecurityFacts(enrichment);
  const trading = buildTradingFacts(market);

  const engine = computeAxiomScore({
    market,
    security,
    trading,
    holderIntel: null,
    whaleActivity: null,
  });

  let score = applyStructuralPenalties(engine.score, token);
  if (!usedHolderEnrichment && score > LIGHTWEIGHT_NO_HOLDERS_SCORE_CAP) {
    score = LIGHTWEIGHT_NO_HOLDERS_SCORE_CAP;
  }
  const { band, label } =
    score === engine.score
      ? { band: engine.band, label: engine.label }
      : classifyAxiomScore(score);

  const result: LightweightAxiomScore = {
    mode: "lightweight",
    score,
    band,
    label,
    confidence: engine.confidence,
    usedHolderEnrichment,
    engine,
    computedAt: Date.now(),
  };

  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first != null) cache.delete(first);
  }
  cache.set(key, result);
  return result;
}

/** Short band label for LIVE badge coloring (same thresholds as Full Score). */
export function lightweightBandTone(
  band: AxiomScoreBand,
): "strong" | "healthy" | "caution" | "risk" {
  if (band === "strong_structure") return "strong";
  if (band === "healthy") return "healthy";
  if (band === "caution") return "caution";
  return "risk";
}

/** Test helper — clear memo cache. */
export function clearLightweightAxiomScoreCache(): void {
  cache.clear();
}
