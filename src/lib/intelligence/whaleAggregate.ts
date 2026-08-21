/**
 * Whale Activity V1.1 — wallet activity aggregation.
 * Groups same-wallet events inside a rolling time window, then re-scores
 * significance on aggregated totals (never fabricates BUY/SELL from transfers).
 */

import type { WhaleActivityEvent, WhaleEventKind } from "./types";
import {
  classifyWhaleSignificance,
  resolveTokenSizeTier,
  type TokenSizeTier,
} from "./whaleThresholds";

/** Rolling aggregation window (max − min timestamp within a cluster). */
export const WHALE_AGG_WINDOW_MS = 10 * 60 * 1000;

/** Pre-aggregation candidate (significance applied after merge). */
export interface WhaleRawCandidate {
  signature: string;
  observedAt: number;
  kind: WhaleEventKind;
  wallet: string;
  supplyPct: number;
  tokenAmountUi: number | null;
  usdValue: number | null;
  isTopHolder: boolean;
  isTop10Holder: boolean;
  isSwap: boolean;
  walletBalancePct: number | null;
}

function shortWallet(address: string): string {
  if (address.length < 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function formatUsd(n: number): string {
  if (n >= 1_000_000) return `~$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `~$${(n / 1_000).toFixed(1)}K`;
  return `~$${n.toFixed(0)}`;
}

function formatAge(msAgo: number): string {
  const m = Math.max(0, Math.floor(msAgo / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Display role only. Reserve "Major holder" for mid/large markets;
 * micro/small use neutral "Large holder".
 */
function holderRole(
  isTopHolder: boolean,
  isTop10: boolean,
  tier: TokenSizeTier,
): string {
  if (isTopHolder) {
    if (tier === "micro" || tier === "small") return "Large holder";
    return "Major holder";
  }
  if (isTop10) return "Large holder";
  return "";
}

/**
 * Greedy clusters: sort by time, start a window at the first event,
 * add events while observedAt − windowStart ≤ windowMs.
 * Same wallet only — caller must pre-group by wallet.
 */
export function clusterByTimeWindow(
  events: WhaleRawCandidate[],
  windowMs: number = WHALE_AGG_WINDOW_MS,
): WhaleRawCandidate[][] {
  if (!events.length) return [];
  const sorted = [...events].sort((a, b) => a.observedAt - b.observedAt);
  const clusters: WhaleRawCandidate[][] = [];
  let current: WhaleRawCandidate[] = [];
  let windowStart = 0;

  for (const ev of sorted) {
    if (!current.length) {
      current = [ev];
      windowStart = ev.observedAt;
      continue;
    }
    if (ev.observedAt - windowStart <= windowMs) {
      current.push(ev);
    } else {
      clusters.push(current);
      current = [ev];
      windowStart = ev.observedAt;
    }
  }
  if (current.length) clusters.push(current);
  return clusters;
}

function groupByWallet(
  events: WhaleRawCandidate[],
): Map<string, WhaleRawCandidate[]> {
  const map = new Map<string, WhaleRawCandidate[]>();
  for (const ev of events) {
    const list = map.get(ev.wallet);
    if (list) list.push(ev);
    else map.set(ev.wallet, [ev]);
  }
  return map;
}

/**
 * Partition swap vs non-swap, cluster each wallet separately, never merge wallets.
 */
export function buildWalletClusters(
  candidates: WhaleRawCandidate[],
  windowMs: number = WHALE_AGG_WINDOW_MS,
): WhaleRawCandidate[][] {
  const swaps: WhaleRawCandidate[] = [];
  const transfers: WhaleRawCandidate[] = [];
  for (const c of candidates) {
    if (c.isSwap) swaps.push(c);
    else transfers.push(c);
  }

  const clusters: WhaleRawCandidate[][] = [];
  for (const bucket of [swaps, transfers]) {
    for (const [, list] of groupByWallet(bucket)) {
      clusters.push(...clusterByTimeWindow(list, windowMs));
    }
  }
  return clusters;
}

function pickDominantTransferKind(members: WhaleRawCandidate[]): WhaleEventKind {
  const rank: Record<string, number> = {
    distribution: 6,
    accumulation: 6,
    top_holder_transfer: 5,
    large_transfer: 4,
    balance_decrease: 3,
    balance_increase: 3,
    holder_movement: 1,
  };
  let best = members[0]!.kind;
  let bestScore = rank[best] ?? 0;
  for (const m of members) {
    const s = rank[m.kind] ?? 0;
    if (s > bestScore) {
      best = m.kind;
      bestScore = s;
    }
  }
  return best;
}

function buildSwapSummary(
  members: WhaleRawCandidate[],
  buyCount: number,
  sellCount: number,
  buyUsd: number,
  sellUsd: number,
  netUsd: number,
  isTopHolder: boolean,
  isTop10: boolean,
  tier: TokenSizeTier,
): string {
  const role = holderRole(isTopHolder, isTop10, tier);
  const swapCount = buyCount + sellCount;
  const absNet = Math.abs(netUsd);
  const usdPart =
    absNet > 0 || buyUsd > 0 || sellUsd > 0
      ? formatUsd(absNet || Math.max(buyUsd, sellUsd))
      : "";
  const walletPart = shortWallet(members[0]!.wallet);

  if (sellCount > 0 && buyCount === 0) {
    const head = role ? `${role} net sold` : "Net sold";
    return `${head} ${usdPart} · ${swapCount} swap${swapCount === 1 ? "" : "s"} · ${walletPart}`;
  }
  if (buyCount > 0 && sellCount === 0) {
    const head = role ? `${role} accumulated` : "Accumulated";
    return `${head} ${usdPart} · ${swapCount} swap${swapCount === 1 ? "" : "s"} · ${walletPart}`;
  }

  // Mixed proven swaps — net direction only.
  if (netUsd < 0) {
    return `Net sold ${usdPart} across ${swapCount} confirmed swaps · ${walletPart}`;
  }
  if (netUsd > 0) {
    return `Net bought ${usdPart} across ${swapCount} confirmed swaps · ${walletPart}`;
  }
  return `${swapCount} confirmed swaps · flat net · ${walletPart}`;
}

function buildTransferSummary(
  members: WhaleRawCandidate[],
  supplyPct: number,
  isTopHolder: boolean,
  isTop10: boolean,
  tier: TokenSizeTier,
): string {
  const n = members.length;
  const pct =
    supplyPct >= 0.01
      ? `${supplyPct.toFixed(supplyPct >= 1 ? 1 : 2)}% supply moved`
      : null;
  const walletPart = shortWallet(members[0]!.wallet);
  const role = holderRole(isTopHolder, isTop10, tier);

  if (n === 1) {
    const m = members[0]!;
    if (m.kind === "distribution" || m.kind === "accumulation") {
      return role
        ? `Significant holder ${m.kind}${pct ? ` · ${pct}` : ""} · ${walletPart}`
        : `Significant ${m.kind}${pct ? ` · ${pct}` : ""} · ${walletPart}`;
    }
    if (m.kind === "top_holder_transfer") {
      return pct ? `Top holder transferred ${pct}` : `Top holder transferred tokens`;
    }
    return pct
      ? `Large transfer · ${pct} · ${walletPart}`
      : `Large transfer · ${walletPart}`;
  }

  return pct
    ? `${n} significant transfers · ${pct} · ${walletPart}`
    : `${n} significant transfers · ${walletPart}`;
}

/**
 * Merge one cluster into a single WhaleActivityEvent and re-score significance.
 * Returns null when the aggregate is not contextually significant.
 */
export function aggregateCluster(
  members: WhaleRawCandidate[],
  context: {
    liquidityUsd: number | null;
    marketCapUsd: number | null;
    nowMs?: number;
  },
): WhaleActivityEvent | null {
  if (!members.length) return null;

  const sorted = [...members].sort((a, b) => a.observedAt - b.observedAt);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const signatures = sorted.map((m) => m.signature);
  const isTopHolder = sorted.some((m) => m.isTopHolder);
  const isTop10Holder = sorted.some((m) => m.isTop10Holder);
  const walletBalancePct = sorted.reduce<number | null>((max, m) => {
    if (m.walletBalancePct == null) return max;
    if (max == null) return m.walletBalancePct;
    return Math.max(max, m.walletBalancePct);
  }, null);

  const supplyPct = sorted.reduce((s, m) => s + m.supplyPct, 0);
  const tokenAmountUi = sorted.reduce<number | null>((sum, m) => {
    if (m.tokenAmountUi == null) return sum;
    return (sum ?? 0) + m.tokenAmountUi;
  }, null);

  const swapCluster = first.isSwap;
  let buyCount = 0;
  let sellCount = 0;
  let buyUsd = 0;
  let sellUsd = 0;
  let transferCount = 0;
  let anyUsd = false;

  if (swapCluster) {
    for (const m of sorted) {
      const usd = m.usdValue;
      if (usd != null && Number.isFinite(usd)) anyUsd = true;
      const u = usd != null && Number.isFinite(usd) ? Math.max(0, usd) : 0;
      if (m.kind === "confirmed_buy") {
        buyCount += 1;
        buyUsd += u;
      } else if (m.kind === "confirmed_sell") {
        sellCount += 1;
        sellUsd += u;
      } else {
        // Defensive: swap-flagged but non buy/sell kind — treat by sign of supply move via kind name.
        transferCount += 1;
      }
    }
  } else {
    transferCount = sorted.length;
  }

  const netUsd = swapCluster && anyUsd ? buyUsd - sellUsd : null;
  const absNet = netUsd != null ? Math.abs(netUsd) : null;
  const grossMax = Math.max(buyUsd, sellUsd);
  // One-sided: score on gross (= |net|). Mixed: score on |net| so wash
  // round-trips do not inflate significance from gross volume alone.
  const usdForScore = swapCluster
    ? buyCount > 0 && sellCount > 0
      ? absNet
      : grossMax > 0
        ? grossMax
        : absNet
    : sorted.reduce<number | null>((max, m) => {
        if (m.usdValue == null) return max;
        if (max == null) return m.usdValue;
        return Math.max(max, m.usdValue);
      }, null);

  const sizeTier = resolveTokenSizeTier(
    context.liquidityUsd,
    context.marketCapUsd,
  );

  let kind: WhaleEventKind;
  let summary: string;

  if (swapCluster) {
    if (sellCount > 0 && buyCount === 0) kind = "confirmed_sell";
    else if (buyCount > 0 && sellCount === 0) kind = "confirmed_buy";
    else if ((netUsd ?? 0) < 0) kind = "confirmed_sell";
    else if ((netUsd ?? 0) > 0) kind = "confirmed_buy";
    else kind = sellCount >= buyCount ? "confirmed_sell" : "confirmed_buy";

    summary = buildSwapSummary(
      sorted,
      buyCount,
      sellCount,
      buyUsd,
      sellUsd,
      netUsd ?? 0,
      isTopHolder,
      isTop10Holder,
      sizeTier,
    );
  } else {
    kind = pickDominantTransferKind(sorted);
    summary = buildTransferSummary(
      sorted,
      supplyPct,
      isTopHolder,
      isTop10Holder,
      sizeTier,
    );
  }

  const kindHint: "buy" | "sell" | "other" =
    kind === "confirmed_sell"
      ? "sell"
      : kind === "confirmed_buy"
        ? "buy"
        : "other";

  const scored = classifyWhaleSignificance({
    supplyPct,
    walletBalancePct,
    usdValue: usdForScore,
    isTopHolder,
    isTop10: isTop10Holder,
    liquidityUsd: context.liquidityUsd,
    marketCapUsd: context.marketCapUsd,
    isSwap: swapCluster,
    kindHint,
  });

  if (!scored.significant) return null;

  const now = context.nowMs ?? Date.now();
  const observedAt = last.observedAt;
  const ageLabel = formatAge(now - observedAt);
  const displayUsd =
    swapCluster && absNet != null && absNet > 0
      ? absNet
      : usdForScore;

  return {
    signature: first.signature,
    signatures,
    observedAt,
    firstObservedAt: first.observedAt,
    lastObservedAt: last.observedAt,
    kind,
    summary,
    ageLabel,
    line: `${ageLabel} · ${summary}`,
    wallet: first.wallet,
    walletShort: shortWallet(first.wallet),
    supplyPct,
    tokenAmountUi,
    usdValue: displayUsd,
    buyUsd,
    sellUsd,
    netUsd,
    buyCount,
    sellCount,
    transferCount,
    aggregated: sorted.length > 1,
    isTopHolder,
    isTop10Holder,
    isSwap: swapCluster,
    major: scored.major,
    riskRelevant: scored.riskRelevant,
    rank: scored.rank,
  };
}

/**
 * Aggregate raw candidates → significant wallet-level events (max applied by caller).
 */
export function aggregateWhaleCandidates(
  candidates: WhaleRawCandidate[],
  context: {
    liquidityUsd: number | null;
    marketCapUsd: number | null;
    nowMs?: number;
    windowMs?: number;
  },
): WhaleActivityEvent[] {
  const clusters = buildWalletClusters(
    candidates,
    context.windowMs ?? WHALE_AGG_WINDOW_MS,
  );
  const out: WhaleActivityEvent[] = [];
  for (const cluster of clusters) {
    const ev = aggregateCluster(cluster, context);
    if (ev) out.push(ev);
  }
  return out.sort((a, b) => b.rank - a.rank || b.observedAt - a.observedAt);
}
