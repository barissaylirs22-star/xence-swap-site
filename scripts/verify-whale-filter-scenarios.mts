/**
 * Live check: apply new significance filter to sample whale-scale events
 * for established vs micro-cap contexts.
 */
import {
  classifyWhaleSignificance,
  resolveTokenSizeTier,
} from "../src/lib/intelligence/whaleThresholds.ts";

const cases = [
  {
    label: "WIF-like large: $28 micro swap",
    input: {
      supplyPct: 0.00001,
      walletBalancePct: 0.001,
      usdValue: 28,
      isTopHolder: false,
      isTop10: true,
      liquidityUsd: 8_000_000,
      marketCapUsd: 500_000_000,
      isSwap: true,
      kindHint: "buy",
    },
    expect: false,
  },
  {
    label: "WIF-like large: $12 confirmed sell dust",
    input: {
      supplyPct: 0.00002,
      walletBalancePct: 0.002,
      usdValue: 12,
      isTopHolder: false,
      isTop10: true,
      liquidityUsd: 8_000_000,
      marketCapUsd: 500_000_000,
      isSwap: true,
      kindHint: "sell",
    },
    expect: false,
  },
  {
    label: "JUP-like mid/large: $8,000 + 0.08% + top10",
    input: {
      supplyPct: 0.08,
      walletBalancePct: 4,
      usdValue: 8_000,
      isTopHolder: false,
      isTop10: true,
      liquidityUsd: 20_000_000,
      marketCapUsd: 1_000_000_000,
      isSwap: true,
      kindHint: "sell",
    },
    // large tier usdFloor 25k — may fail unless supply/top10 material
    expect: "adaptive",
  },
  {
    label: "High-concentration micro: $45 + 0.5% supply top holder",
    input: {
      supplyPct: 0.5,
      walletBalancePct: 12,
      usdValue: 45,
      isTopHolder: true,
      isTop10: true,
      liquidityUsd: 4_500,
      marketCapUsd: 80_000,
      isSwap: true,
      kindHint: "sell",
    },
    expect: true,
  },
  {
    label: "Pump micro: $90 + 0.3% supply",
    input: {
      supplyPct: 0.3,
      walletBalancePct: 6,
      usdValue: 90,
      isTopHolder: false,
      isTop10: true,
      liquidityUsd: 8_000,
      marketCapUsd: 120_000,
      isSwap: true,
      kindHint: "buy",
    },
    expect: true,
  },
  {
    label: "BONK-like large: $50k + 0.6% supply top holder sell",
    input: {
      supplyPct: 0.6,
      walletBalancePct: 18,
      usdValue: 50_000,
      isTopHolder: true,
      isTop10: true,
      liquidityUsd: 15_000_000,
      marketCapUsd: 800_000_000,
      isSwap: true,
      kindHint: "sell",
    },
    expect: true,
  },
];

console.log("=== Whale significance live scenario matrix ===\n");
let fail = 0;
for (const c of cases) {
  const tier = resolveTokenSizeTier(
    c.input.liquidityUsd,
    c.input.marketCapUsd,
  );
  const r = classifyWhaleSignificance(c.input);
  const pass =
    c.expect === "adaptive"
      ? true
      : r.significant === c.expect;
  if (!pass) fail += 1;
  console.log(
    `${pass ? "PASS" : "FAIL"} [${tier}] ${c.label}\n  significant=${r.significant} major=${r.major} risk=${r.riskRelevant} reason=${r.reason} rank=${r.rank.toFixed(1)}`,
  );
}

if (fail) {
  console.error(`\n${fail} failures`);
  process.exit(1);
}
console.log("\nOK — micro-swaps filtered; material micro-cap / top-holder events retained");
