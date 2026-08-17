/**
 * Unit checks for adaptive whale significance filtering.
 */
import {
  classifyWhaleSignificance,
  resolveTokenSizeTier,
  tierThresholds,
} from "../src/lib/intelligence/whaleThresholds.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

// --- Tier resolution ---
assert(resolveTokenSizeTier(2_000_000, null) === "large", "large by liq");
assert(resolveTokenSizeTier(50_000, 6_000_000) === "mid", "mid by mcap");
assert(resolveTokenSizeTier(15_000, null) === "small", "small");
assert(resolveTokenSizeTier(2_000, 50_000) === "micro", "micro");

// --- Micro $8–$28 swaps on established (large) tokens MUST filter ---
for (const usd of [8, 10, 12, 28, 50, 99]) {
  const r = classifyWhaleSignificance({
    supplyPct: 0.001,
    walletBalancePct: 0.01,
    usdValue: usd,
    isTopHolder: false,
    isTop10: true, // even if watching a large wallet
    liquidityUsd: 5_000_000,
    marketCapUsd: 100_000_000,
    isSwap: true,
    kindHint: "buy",
  });
  assert(!r.significant, `large-tier dust $${usd} must filter (${r.reason})`);
}

// --- Same tiny USD on micro-cap with material supply CAN pass ---
const microMaterial = classifyWhaleSignificance({
  supplyPct: 0.4,
  walletBalancePct: 8,
  usdValue: 28,
  isTopHolder: true,
  isTop10: true,
  liquidityUsd: 3_000,
  marketCapUsd: 40_000,
  isSwap: true,
  kindHint: "buy",
});
assert(
  microMaterial.significant,
  `micro-cap material supply should pass: ${microMaterial.reason}`,
);

// --- Top holder material wallet move on mid tier ---
const topHolderMove = classifyWhaleSignificance({
  supplyPct: 0.2,
  walletBalancePct: 18,
  usdValue: 800,
  isTopHolder: true,
  isTop10: true,
  liquidityUsd: 200_000,
  marketCapUsd: 8_000_000,
  isSwap: false,
  kindHint: "other",
});
assert(topHolderMove.significant, "top holder wallet move");
assert(topHolderMove.riskRelevant, "top holder move riskRelevant");

// --- Established token needs large USD + size signal ---
const midOk = classifyWhaleSignificance({
  supplyPct: 0.08,
  walletBalancePct: 3,
  usdValue: 6_000,
  isTopHolder: false,
  isTop10: true,
  liquidityUsd: 250_000,
  marketCapUsd: 10_000_000,
  isSwap: true,
  kindHint: "sell",
});
assert(midOk.significant, `mid usd+size: ${midOk.reason}`);

const midUsdOnly = classifyWhaleSignificance({
  supplyPct: 0.001,
  walletBalancePct: 0.01,
  usdValue: 6_000,
  isTopHolder: false,
  isTop10: false,
  liquidityUsd: 250_000,
  marketCapUsd: 10_000_000,
  isSwap: true,
  kindHint: "buy",
});
assert(!midUsdOnly.significant, "usd alone without size signal must fail");

// --- Ranking prefers top-holder sell over generic ---
const sell = classifyWhaleSignificance({
  supplyPct: 0.6,
  walletBalancePct: 20,
  usdValue: 30_000,
  isTopHolder: true,
  isTop10: true,
  liquidityUsd: 2_000_000,
  marketCapUsd: 80_000_000,
  isSwap: true,
  kindHint: "sell",
});
const buy = classifyWhaleSignificance({
  supplyPct: 0.6,
  walletBalancePct: 20,
  usdValue: 30_000,
  isTopHolder: true,
  isTop10: true,
  liquidityUsd: 2_000_000,
  marketCapUsd: 80_000_000,
  isSwap: true,
  kindHint: "buy",
});
assert(sell.rank > buy.rank, "top-holder sell ranks above buy");

console.log("tier thresholds large", tierThresholds("large"));
console.log("PASS — adaptive whale significance filters micro-swaps");
console.log(
  "retained micro example:",
  microMaterial.reason,
  "rank",
  microMaterial.rank.toFixed(1),
);
console.log("retained top-holder:", topHolderMove.reason);
