/**
 * Full Axiom Score cache for AXIOM LIVE display/sort sync.
 *
 * Precedence for Live rows and AXM Score filter:
 *   cached valid Full Score for mint → otherwise lightweight preview
 *
 * Populated only when Token Detail produces a real Full AxiomScoreResult.
 * No network I/O. No score transformation.
 */

import { getCached, setCached } from "@/lib/market/cache";
import { ONCHAIN_REFETCH_MS } from "@/config/providers";
import type { AxiomScoreBand, AxiomScoreResult } from "@/lib/intelligence";
import {
  computeLightweightAxiomScore,
  lightweightBandTone,
  type LightweightScoreEnrichment,
} from "./lightweightScore";
import type { TokenAsset } from "@/lib/tokens/types";

export type ResolvedLiveAxiomScoreMode = "full" | "lightweight";

export interface ResolvedLiveAxiomScore {
  mode: ResolvedLiveAxiomScoreMode;
  score: number;
  band: AxiomScoreBand;
  label: string;
}

interface CachedFullAxiomScore {
  mint: string;
  score: number;
  band: AxiomScoreBand;
  label: string;
  computedAt: number;
}

const cacheKey = (mint: string) => `axiom:full-score:v1:${mint}`;

/** Align with holder/on-chain success TTL used by Token Intelligence. */
export const FULL_AXIOM_SCORE_TTL_MS = ONCHAIN_REFETCH_MS;

let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeFullAxiomScoreCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFullAxiomScoreCacheVersion(): number {
  return version;
}

/** Read a still-valid Full Score for mint, or null. */
export function peekFullAxiomScore(mint: string): CachedFullAxiomScore | null {
  const trimmed = mint.trim();
  if (!trimmed) return null;
  return getCached<CachedFullAxiomScore>(cacheKey(trimmed));
}

/**
 * Store an actual Full Axiom Score from Token Detail (exact values, no transform).
 * Extends/replaces TTL for that mint only.
 */
export function rememberFullAxiomScore(
  mint: string,
  result: AxiomScoreResult,
): void {
  const trimmed = mint.trim();
  if (!trimmed) return;
  if (!Number.isFinite(result.score)) return;

  const prev = getCached<CachedFullAxiomScore>(cacheKey(trimmed));
  const next: CachedFullAxiomScore = {
    mint: trimmed,
    score: result.score,
    band: result.band,
    label: result.label,
    computedAt: result.computedAt || Date.now(),
  };

  setCached(cacheKey(trimmed), next, FULL_AXIOM_SCORE_TTL_MS);

  if (
    !prev ||
    prev.score !== next.score ||
    prev.band !== next.band ||
    prev.label !== next.label
  ) {
    emit();
  }
}

/**
 * ONE precedence for Live badge + AXM Score sort/filter.
 * Full cache hit returns exact Full Score fields; else lightweight preview.
 */
export function resolveLiveAxiomScore(
  token: TokenAsset,
  enrichment?: LightweightScoreEnrichment | null,
  now = Date.now(),
): ResolvedLiveAxiomScore | null {
  const full = peekFullAxiomScore(token.mint);
  if (full) {
    return {
      mode: "full",
      score: full.score,
      band: full.band,
      label: full.label,
    };
  }

  const lite = computeLightweightAxiomScore(token, enrichment, now);
  if (!lite) return null;
  return {
    mode: "lightweight",
    score: lite.score,
    band: lite.band,
    label: lite.label,
  };
}

export { lightweightBandTone };
