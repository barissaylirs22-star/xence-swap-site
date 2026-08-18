/**
 * Compact holder-concentration cue for AXIOM LIVE rows.
 * Uses ONLY DiscoveryEnrichment already on the row — no new RPC/API.
 * Thresholds match Risk Analysis / riskLite (MEDIUM floor = meaningful risk).
 */

import type { DiscoveryEnrichment } from "@/lib/discovery/filters";
import {
  RISK_TOP10_HIGH_PCT,
  RISK_TOP10_MEDIUM_PCT,
  RISK_TOP_HOLDER_HIGH_PCT,
  RISK_TOP_HOLDER_MEDIUM_PCT,
} from "@/lib/intelligence/risk";

export type ConcentrationCueId = "top_holder" | "top10";

export interface ConcentrationCue {
  id: ConcentrationCueId;
  /** Short scan label including the measured share, e.g. TOP HOLDER 71.8%. */
  label: string;
  /** Absolute share used in the label (for styling / title). */
  pct: number;
  /** Aligns with riskLite severity bands. */
  severity: "medium" | "high";
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

function formatShare(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/**
 * At most one concentration warning when enrichment measured a risky share.
 * Prefer largest-holder over top-10 when both clear the MEDIUM floor.
 * Returns null when enrichment is missing, loading, or below risk thresholds.
 */
export function deriveConcentrationCue(
  enrichment: DiscoveryEnrichment | null | undefined,
): ConcentrationCue | null {
  if (!enrichment || enrichment.status !== "ready") return null;

  const top = finite(enrichment.topHolderPct) ? enrichment.topHolderPct : null;
  const top10 = finite(enrichment.top10HolderPct)
    ? enrichment.top10HolderPct
    : null;

  if (top != null && top >= RISK_TOP_HOLDER_HIGH_PCT) {
    return {
      id: "top_holder",
      label: `TOP HOLDER ${formatShare(top)}`,
      pct: top,
      severity: "high",
    };
  }

  if (top10 != null && top10 >= RISK_TOP10_HIGH_PCT) {
    return {
      id: "top10",
      label: `TOP 10 ${formatShare(top10)}`,
      pct: top10,
      severity: "high",
    };
  }

  if (top != null && top >= RISK_TOP_HOLDER_MEDIUM_PCT) {
    return {
      id: "top_holder",
      label: `TOP HOLDER ${formatShare(top)}`,
      pct: top,
      severity: "medium",
    };
  }

  if (top10 != null && top10 >= RISK_TOP10_MEDIUM_PCT) {
    return {
      id: "top10",
      label: `TOP 10 ${formatShare(top10)}`,
      pct: top10,
      severity: "medium",
    };
  }

  return null;
}
