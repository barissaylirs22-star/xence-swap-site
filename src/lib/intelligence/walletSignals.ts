/**
 * Wallet Signals V1 — observational large-holder activity from existing Whale Activity.
 *
 * NOT smart-money scoring. NOT PnL / win-rate / cross-token reputation.
 * Derives explainable labels from WhaleActivityEvent fields already on Token Detail.
 * Pure function — zero network I/O.
 */

import type { WhaleActivityEvent, WhaleActivityFacts } from "./types";
import { WHALE_USD_MAJOR } from "./whaleThresholds";

export type WalletSignalCode =
  | "notable_accumulation"
  | "notable_distribution"
  | "strong_accumulation"
  | "strong_distribution"
  | "repeat_activity"
  | "large_holder_activity";

export type WalletSignalDirection =
  | "accumulating"
  | "distributing"
  | "mixed"
  | "activity";

export interface WalletSignal {
  code: WalletSignalCode;
  /** Short badge / heading — observational only. */
  label: string;
  direction: WalletSignalDirection;
  wallet: string;
  walletShort: string;
  /** Approximate |net| or event USD when known. */
  usdApprox: number | null;
  /** Confirmed swap legs in the observation window. */
  swapCount: number;
  /** Underlying events contributing to this wallet signal. */
  eventCount: number;
  reason: string;
  major: boolean;
  isTopHolder: boolean;
  repeatActivity: boolean;
}

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `~$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `~$${(abs / 1_000).toFixed(1)}K`;
  return `~$${Math.round(abs)}`;
}

function isAccumKind(kind: WhaleActivityEvent["kind"]): boolean {
  return (
    kind === "confirmed_buy" ||
    kind === "accumulation" ||
    kind === "balance_increase"
  );
}

function isDistribKind(kind: WhaleActivityEvent["kind"]): boolean {
  return (
    kind === "confirmed_sell" ||
    kind === "distribution" ||
    kind === "balance_decrease"
  );
}

interface WalletBucket {
  wallet: string;
  walletShort: string;
  events: WhaleActivityEvent[];
  buyUsd: number;
  sellUsd: number;
  netUsd: number | null;
  swapCount: number;
  transferCount: number;
  major: boolean;
  isTopHolder: boolean;
  riskRelevant: boolean;
}

function bucketByWallet(events: WhaleActivityEvent[]): WalletBucket[] {
  const map = new Map<string, WalletBucket>();
  for (const ev of events) {
    if (!ev.wallet) continue;
    let b = map.get(ev.wallet);
    if (!b) {
      b = {
        wallet: ev.wallet,
        walletShort: ev.walletShort || ev.wallet,
        events: [],
        buyUsd: 0,
        sellUsd: 0,
        netUsd: null,
        swapCount: 0,
        transferCount: 0,
        major: false,
        isTopHolder: false,
        riskRelevant: false,
      };
      map.set(ev.wallet, b);
    }
    b.events.push(ev);
    b.buyUsd += ev.buyUsd || 0;
    b.sellUsd += ev.sellUsd || 0;
    b.swapCount += (ev.buyCount || 0) + (ev.sellCount || 0);
    b.transferCount += ev.transferCount || 0;
    if (ev.major) b.major = true;
    if (ev.isTopHolder) b.isTopHolder = true;
    if (ev.riskRelevant) b.riskRelevant = true;
  }

  for (const b of map.values()) {
    const hasSwapUsd = b.buyUsd > 0 || b.sellUsd > 0;
    b.netUsd = hasSwapUsd ? b.buyUsd - b.sellUsd : null;
  }

  return [...map.values()];
}

function resolveDirection(b: WalletBucket): WalletSignalDirection {
  if (b.netUsd != null && Number.isFinite(b.netUsd)) {
    if (b.netUsd > 0) return "accumulating";
    if (b.netUsd < 0) return "distributing";
  }
  const accum = b.events.some((e) => isAccumKind(e.kind));
  const distrib = b.events.some((e) => isDistribKind(e.kind));
  if (accum && !distrib) return "accumulating";
  if (distrib && !accum) return "distributing";
  if (accum && distrib) return "mixed";
  return "activity";
}

function usdApprox(b: WalletBucket, direction: WalletSignalDirection): number | null {
  if (b.netUsd != null && Number.isFinite(b.netUsd) && b.netUsd !== 0) {
    return Math.abs(b.netUsd);
  }
  const fromEvents = b.events
    .map((e) => e.usdValue)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (!fromEvents.length) return null;
  const sum = fromEvents.reduce((a, n) => a + n, 0);
  if (direction === "activity" || direction === "mixed") return sum;
  return sum;
}

function isRepeat(b: WalletBucket): boolean {
  if (b.events.length >= 2) return true;
  if (b.swapCount >= 2) return true;
  if (b.events.some((e) => e.aggregated && e.signatures.length >= 2)) return true;
  if (b.swapCount + b.transferCount >= 2) return true;
  return false;
}

/**
 * Derive observational wallet signals from existing Whale Activity facts.
 * Returns [] when whale data is missing/unavailable — never invents activity.
 */
export function deriveWalletSignals(
  facts: WhaleActivityFacts | null | undefined,
): WalletSignal[] {
  if (!facts || facts.status !== "ready" || !facts.events.length) {
    return [];
  }

  // Never claim smart-money verification from this layer.
  void facts.smartMoneyAvailable;

  const buckets = bucketByWallet(facts.events);
  const out: WalletSignal[] = [];

  for (const b of buckets) {
    const direction = resolveDirection(b);
    const repeatActivity = isRepeat(b);
    const usd = usdApprox(b, direction);
    const strongUsd =
      usd != null && usd >= WHALE_USD_MAJOR ? true : b.major && usd != null;

    let code: WalletSignalCode;
    let label: string;
    let reason: string;

    if (direction === "accumulating" && (b.major || b.riskRelevant || strongUsd)) {
      if (b.major && strongUsd) {
        code = "strong_accumulation";
        // Stronger significance/risk tier only.
        label = b.isTopHolder ? "Major holder" : "Strong accumulation";
        reason =
          "Unusually strong net buying observed from a large holder in the current observation window.";
      } else {
        // Small / non-major display tier — neutral observational labels.
        code = "notable_accumulation";
        label = "Holder accumulation";
        reason = repeatActivity
          ? "Repeated large-holder accumulation detected in the current observation window."
          : "Large-holder accumulation observed in the current window.";
      }
    } else if (
      direction === "distributing" &&
      (b.major || b.riskRelevant || strongUsd)
    ) {
      if (b.major && strongUsd) {
        code = "strong_distribution";
        label = b.isTopHolder ? "Major holder" : "Strong distribution";
        reason =
          "Unusually strong net selling observed from a large holder in the current observation window.";
      } else {
        code = "notable_distribution";
        label = "Holder distribution";
        reason = repeatActivity
          ? "Repeated large-holder distribution detected in the current observation window."
          : "Large-holder distribution observed in the current window.";
      }
    } else if (b.isTopHolder || b.major || b.riskRelevant) {
      code = "large_holder_activity";
      label = "Large holder activity";
      reason =
        "Observable activity from a large token holder in the current window — not a skill or profitability rating.";
    } else if (repeatActivity) {
      code = "repeat_activity";
      label = "Large holder activity";
      reason =
        "Multiple observed events from the same wallet in the current window.";
    } else {
      // Minor residual events — skip to avoid clutter.
      continue;
    }

    out.push({
      code,
      label,
      direction,
      wallet: b.wallet,
      walletShort: b.walletShort,
      usdApprox: usd,
      swapCount: b.swapCount,
      eventCount: b.events.length,
      reason,
      major: b.major,
      isTopHolder: b.isTopHolder,
      repeatActivity,
    });
  }

  // Strongest first, then USD, cap list for UI.
  const rank = (s: WalletSignal): number => {
    switch (s.code) {
      case "strong_accumulation":
      case "strong_distribution":
        return 5;
      case "notable_accumulation":
      case "notable_distribution":
        return 4;
      case "large_holder_activity":
        return 3;
      case "repeat_activity":
        return 2;
      default:
        return 1;
    }
  };

  return out
    .sort((a, b) => {
      const d = rank(b) - rank(a);
      if (d !== 0) return d;
      return (b.usdApprox ?? 0) - (a.usdApprox ?? 0);
    })
    .slice(0, 5);
}

/** Compact LIVE-safe summary — only if signals already exist (no fetch). */
export function summarizeWalletSignalsForBadge(
  signals: WalletSignal[],
): { label: string; title: string } | null {
  if (!signals.length) return null;
  const top = signals[0]!;
  if (top.direction === "accumulating") {
    return {
      label: top.repeatActivity ? "REPEAT BUYING" : "LARGE HOLDER ↑",
      title: `${top.label} · ${top.walletShort} · ${top.reason}`,
    };
  }
  if (top.direction === "distributing") {
    return {
      label: top.repeatActivity ? "REPEAT SELLING" : "LARGE HOLDER ↓",
      title: `${top.label} · ${top.walletShort} · ${top.reason}`,
    };
  }
  return {
    label: "NOTABLE WALLET",
    title: `${top.label} · ${top.walletShort} · ${top.reason}`,
  };
}

export function formatWalletSignalUsd(usd: number | null): string | null {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return null;
  return formatUsd(usd);
}
