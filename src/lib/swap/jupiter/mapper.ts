import { QUOTE_STALE_MS } from "@/config/providers";
import { SwapError } from "@/lib/swap/errors";
import type { RouteHop, SwapQuote } from "@/lib/swap/types";

interface JupiterRouteHop {
  percent?: number;
  swapInfo?: {
    label?: string;
  };
}

interface JupiterQuoteResponse {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  priceImpactPct?: string | number;
  routePlan?: JupiterRouteHop[];
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function summarizeRoute(hops: RouteHop[]): string {
  if (hops.length === 0) return "Best available route";
  if (hops.length === 1) return hops[0]?.label || "Direct route";
  return hops.map((h) => h.label).filter(Boolean).join(" → ");
}

/** Validate and map a provider quote into the Axiom quote model. Fail closed. */
export function mapJupiterQuote(
  raw: unknown,
  expected: {
    inputMint: string;
    outputMint: string;
    amountRaw: string;
    slippageBps: number;
  },
): SwapQuote {
  if (!isRecord(raw)) {
    throw new SwapError("quote_unavailable", "No trading route available.");
  }

  const data = raw as JupiterQuoteResponse;
  if (data.error) {
    throw new SwapError("quote_unavailable", "No trading route available.");
  }

  const inputMint = asString(data.inputMint);
  const outputMint = asString(data.outputMint);
  const inAmount = asString(data.inAmount);
  const outAmount = asString(data.outAmount);
  const minOut = asString(data.otherAmountThreshold);
  const slippageBps = asNumber(data.slippageBps);

  if (
    !inputMint ||
    !outputMint ||
    !inAmount ||
    !outAmount ||
    !minOut ||
    slippageBps === null
  ) {
    throw new SwapError("quote_unavailable", "No trading route available.");
  }

  if (inputMint !== expected.inputMint || outputMint !== expected.outputMint) {
    throw new SwapError("quote_unavailable", "No trading route available.");
  }

  if (inAmount !== expected.amountRaw) {
    throw new SwapError("quote_unavailable", "No trading route available.");
  }

  // Reject empty routes — fail closed rather than inventing liquidity.
  if (!Array.isArray(data.routePlan) || data.routePlan.length === 0) {
    throw new SwapError("quote_unavailable", "No trading route available.");
  }

  const hops: RouteHop[] = Array.isArray(data.routePlan)
    ? data.routePlan.map((hop) => ({
        label: hop.swapInfo?.label?.trim() || "Pool",
        percent: typeof hop.percent === "number" ? hop.percent : 0,
      }))
    : [];

  const now = Date.now();
  return {
    inputMint,
    outputMint,
    inAmountRaw: inAmount,
    outAmountRaw: outAmount,
    minOutAmountRaw: minOut,
    slippageBps,
    priceImpactPct: asNumber(data.priceImpactPct),
    routeSummary: summarizeRoute(hops),
    hops,
    providerPayload: raw,
    quotedAt: now,
    expiresAt: now + QUOTE_STALE_MS,
  };
}

export function mapJupiterSwapTransaction(raw: unknown): {
  transactionBase64: string;
  lastValidBlockHeight?: number;
} {
  if (!isRecord(raw)) {
    throw new SwapError("build_failed", "Could not prepare the swap.");
  }

  const tx = asString(raw.swapTransaction);
  if (!tx) {
    throw new SwapError("build_failed", "Could not prepare the swap.");
  }

  const lastValidBlockHeight = asNumber(raw.lastValidBlockHeight) ?? undefined;
  return {
    transactionBase64: tx,
    lastValidBlockHeight:
      lastValidBlockHeight !== undefined
        ? Math.trunc(lastValidBlockHeight)
        : undefined,
  };
}
