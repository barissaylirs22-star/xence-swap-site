/**
 * Offline Wallet Signals V1 checks. ZERO network.
 * Usage: node scripts/verify-wallet-signals-v1.mjs
 */
import { createServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
});

const now = Date.now();

function event(over = {}) {
  return {
    signature: "sig1",
    signatures: ["sig1"],
    observedAt: now,
    firstObservedAt: now,
    lastObservedAt: now,
    kind: "confirmed_buy",
    summary: "buy",
    line: "line",
    ageLabel: "1h",
    wallet: "CpdC1111111111111111111111111111111111K9jF",
    walletShort: "CpdC…K9jF",
    supplyPct: 1.2,
    tokenAmountUi: 1000,
    usdValue: 18_400,
    buyUsd: 18_400,
    sellUsd: 0,
    netUsd: 18_400,
    buyCount: 1,
    sellCount: 0,
    transferCount: 0,
    aggregated: false,
    isTopHolder: true,
    isTop10Holder: true,
    isSwap: true,
    major: false,
    riskRelevant: true,
    rank: 10,
    ...over,
  };
}

function facts(events, over = {}) {
  return {
    status: "ready",
    events,
    smartMoneyAvailable: false,
    analyzedAccounts: 5,
    updatedAt: now,
    errorMessage: null,
    ...over,
  };
}

try {
  const {
    deriveWalletSignals,
    summarizeWalletSignalsForBadge,
    AXIOM_SCORE_WEIGHTS,
  } = await server.ssrLoadModule("/src/lib/intelligence/index.ts");

  // Re-export early signals from discovery for regression check
  const earlyMod = await server.ssrLoadModule(
    "/src/lib/discovery/earlySignals.ts",
  );

  // 1) Missing / unavailable → empty
  if (deriveWalletSignals(null).length !== 0) {
    throw new Error("null facts must yield no signals");
  }
  if (
    deriveWalletSignals({
      status: "unavailable",
      events: [],
      smartMoneyAvailable: false,
      analyzedAccounts: 0,
      updatedAt: now,
      errorMessage: "x",
    }).length !== 0
  ) {
    throw new Error("unavailable must yield no signals");
  }
  if (deriveWalletSignals(facts([])).length !== 0) {
    throw new Error("empty events must yield no signals");
  }

  // 2) Notable accumulation
  const accum = deriveWalletSignals(facts([event()]));
  if (!accum.some((s) => s.code === "notable_accumulation")) {
    throw new Error(`expected notable_accumulation got ${JSON.stringify(accum)}`);
  }
  if (accum[0].direction !== "accumulating") {
    throw new Error("expected accumulating direction");
  }
  if (!accum[0].reason.toLowerCase().includes("accumulation")) {
    throw new Error("reason must describe accumulation");
  }

  // 3) Notable distribution
  const distrib = deriveWalletSignals(
    facts([
      event({
        kind: "confirmed_sell",
        buyUsd: 0,
        sellUsd: 12_000,
        netUsd: -12_000,
        buyCount: 0,
        sellCount: 1,
        usdValue: 12_000,
        riskRelevant: true,
        major: false,
      }),
    ]),
  );
  if (!distrib.some((s) => s.code === "notable_distribution")) {
    throw new Error("expected notable_distribution");
  }

  // 4) Repeat activity
  const repeat = deriveWalletSignals(
    facts([
      event({
        signature: "a",
        signatures: ["a", "b", "c"],
        buyCount: 3,
        sellCount: 0,
        buyUsd: 30_000,
        netUsd: 30_000,
        usdValue: 30_000,
        aggregated: true,
        major: true,
        riskRelevant: true,
      }),
    ]),
  );
  if (!repeat[0]?.repeatActivity) {
    throw new Error("expected repeatActivity flag");
  }

  // 5) Strong accumulation
  const strong = deriveWalletSignals(
    facts([
      event({
        major: true,
        buyUsd: 40_000,
        netUsd: 40_000,
        usdValue: 40_000,
        buyCount: 2,
        aggregated: true,
        signatures: ["x", "y"],
      }),
    ]),
  );
  if (!strong.some((s) => s.code === "strong_accumulation")) {
    throw new Error(`expected strong_accumulation got ${JSON.stringify(strong)}`);
  }

  // 6) No false smart-money claim in labels/reasons
  const all = [...accum, ...distrib, ...repeat, ...strong];
  for (const s of all) {
    const blob = `${s.label} ${s.reason}`.toLowerCase();
    if (
      blob.includes("verified smart") ||
      blob.includes("profitable") ||
      blob.includes("win rate") ||
      blob.includes("high win")
    ) {
      throw new Error(`forbidden smart-money claim: ${blob}`);
    }
  }

  // 7) smartMoneyAvailable true still does not invent verification language
  const fakeSmart = deriveWalletSignals(
    facts([event()], { smartMoneyAvailable: true }),
  );
  for (const s of fakeSmart) {
    if (/verified smart|profitable|win rate/i.test(`${s.label} ${s.reason}`)) {
      throw new Error("smartMoneyAvailable must not create verification claims");
    }
  }

  // 8) Badge helper
  const badge = summarizeWalletSignalsForBadge(accum);
  if (!badge || /smart money|profitable/i.test(`${badge.label} ${badge.title}`)) {
    throw new Error("badge helper invalid");
  }

  // 9) AXM Score weights unchanged (regression)
  if (AXIOM_SCORE_WEIGHTS.whale !== 15) {
    throw new Error("AXM Score weights changed unexpectedly");
  }

  // 10) Early Signals still pure / unchanged API
  const early = earlyMod.assessEarlySignal(
    {
      mint: "x",
      symbol: "X",
      name: "X",
      decimals: 6,
      selectable: true,
      liquidityUsd: 1_000,
      volume24hUsd: 1_000,
    },
    null,
  );
  if (!early || typeof early.level !== "string") {
    throw new Error("Early Signals API regression");
  }

  console.log(
    JSON.stringify({
      ok: true,
      accum: accum[0]?.label,
      distrib: distrib[0]?.code,
      strong: strong[0]?.code,
      repeat: repeat[0]?.repeatActivity,
    }),
  );
  console.log("WALLET_SIGNALS_V1_OK");
} finally {
  await server.close();
}
