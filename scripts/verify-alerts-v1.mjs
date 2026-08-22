/**
 * Offline ALERTS V1 checks (scenarios A–W). ZERO network.
 * Usage: node scripts/verify-alerts-v1.mjs
 */
import { createServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

/** Minimal localStorage for watchlist/events persistence tests. */
const mem = new Map();
globalThis.localStorage = {
  getItem(k) {
    return mem.has(k) ? mem.get(k) : null;
  },
  setItem(k, v) {
    mem.set(k, String(v));
  },
  removeItem(k) {
    mem.delete(k);
  },
  clear() {
    mem.clear();
  },
  key() {
    return null;
  },
  get length() {
    return mem.size;
  },
};

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
});

const now = Date.now();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function token(over = {}) {
  return {
    mint: "Alert111111111111111111111111111111111111",
    symbol: "ALT",
    name: "Alert",
    decimals: 6,
    selectable: true,
    priceUsd: 0.02,
    priceChange5mPct: 0,
    priceChange1hPct: 0,
    volume24hUsd: 5_000,
    liquidityUsd: 50_000,
    marketCapUsd: 200_000,
    fdvUsd: 200_000,
    listedAt: now - 10 * 60 * 60 * 1000,
    isFresh: false,
    ...over,
  };
}

function enrich(over = {}) {
  return {
    holderCount: 800,
    topHolderPct: 18,
    top10HolderPct: 42,
    riskLevel: "MEDIUM",
    status: "ready",
    holderGrowth: null,
    concentrationTrend: null,
    ...over,
  };
}

function growth(over = {}) {
  return {
    absolute: 80,
    percent: 12,
    fromAt: now - 3600_000,
    toAt: now,
    fromCount: 650,
    toCount: 730,
    window: "1h",
    actualElapsedMs: 3600_000,
    ...over,
  };
}

function trendRising(over = {}) {
  return {
    available: true,
    largestTrend: "increasing",
    top10Trend: "stable",
    largestDeltaPp: 3.5,
    top10DeltaPp: 0,
    preferredWindow: "1h",
    comparedAt: now - 3600_000,
    signals: [],
    ...over,
  };
}

function trendImproving(over = {}) {
  return {
    available: true,
    largestTrend: "decreasing",
    top10Trend: "stable",
    largestDeltaPp: -3.5,
    top10DeltaPp: 0,
    preferredWindow: "1h",
    comparedAt: now - 3600_000,
    signals: [],
    ...over,
  };
}

function followed(mint, over = {}) {
  return { mint, symbol: "ALT", name: "Alert", createdAt: now, ...over };
}

try {
  const {
    evaluateAlerts,
    assessLiquidityDrop,
    followToken,
    unfollowToken,
    loadWatchlist,
    isFollowed,
    appendAlertEvents,
    loadAlertEvents,
    saveAlertEvents,
    trimAlertEvents,
    resetAlertStorageForTests,
    ALERT_MAX_EVENTS,
    ALERT_COOLDOWN_MS,
    ALERT_PRIORITY,
  } = await server.ssrLoadModule("/src/lib/alerts/index.ts");

  const { assessEarlySignal } = await server.ssrLoadModule(
    "/src/lib/discovery/earlySignals.ts",
  );
  const { RADAR_LIQ_MOVE_PCT, RADAR_LIQ_MOVE_USD } = await server.ssrLoadModule(
    "/src/lib/discovery/radarEvents.ts",
  );
  const { DISCOVERY_TARGET } = await server.ssrLoadModule(
    "/src/lib/market/dexscreener.ts",
  );

  // W) Early/Risk formulas reused — evaluate imports assessEarlySignal + radar constants
  const evalSrc = readFileSync(
    resolve(root, "src/lib/alerts/evaluate.ts"),
    "utf8",
  );
  assert(
    evalSrc.includes("assessEarlySignal"),
    "W: evaluate must reuse assessEarlySignal",
  );
  assert(
    evalSrc.includes("RADAR_LIQ_MOVE_PCT") &&
      evalSrc.includes("RADAR_LIQ_MOVE_USD"),
    "W: evaluate must reuse Radar liquidity thresholds",
  );
  assert(
    !evalSrc.includes("fetch(") && !evalSrc.includes("XMLHttpRequest"),
    "U: evaluator must not make network calls",
  );

  resetAlertStorageForTests();

  // A) Follow persists
  followToken({ mint: "MintA", symbol: "A", name: "Alpha", now });
  assert(isFollowed("MintA"), "A: followed after followToken");
  assert(
    loadWatchlist().some((t) => t.mint === "MintA"),
    "A: watchlist contains mint",
  );
  const reloaded = loadWatchlist();
  assert(reloaded[0].mint === "MintA", "A: persists via localStorage reload");

  // B) Unfollow persists
  unfollowToken("MintA");
  assert(!isFollowed("MintA"), "B: unfollowed");
  assert(loadWatchlist().length === 0, "B: watchlist empty after unfollow");

  resetAlertStorageForTests();
  const mint = token().mint;
  const f = [followed(mint)];

  // C) First observation HIGH establishes baseline, no alert
  let arms = {};
  let r = evaluateAlerts({
    followed: f,
    observations: [
      { mint, riskLevel: "HIGH", enrichment: enrich({ riskLevel: "HIGH" }) },
    ],
    arms,
    now,
  });
  assert(r.newEvents.length === 0, "C: first HIGH must not alert");
  arms = r.arms;
  assert(
    arms[`${mint}:RISK_BECAME_HIGH`]?.baselined === true,
    "C: HIGH baselined",
  );
  assert(arms[`${mint}:RISK_BECAME_HIGH`]?.active === true, "C: active HIGH");

  // D) MEDIUM → HIGH fires once
  r = evaluateAlerts({
    followed: f,
    observations: [{ mint, riskLevel: "MEDIUM" }],
    arms,
    now: now + 1000,
  });
  assert(r.newEvents.length === 0, "D setup: MEDIUM re-arms without fire");
  arms = r.arms;
  r = evaluateAlerts({
    followed: f,
    observations: [{ mint, riskLevel: "HIGH" }],
    arms,
    now: now + 2000,
  });
  assert(r.newEvents.length === 1, "D: MEDIUM→HIGH fires once");
  assert(r.newEvents[0].type === "RISK_BECAME_HIGH", "D: type RISK_BECAME_HIGH");
  assert(r.newEvents[0].priority === "CRITICAL", "D: CRITICAL");
  assert(
    /MEDIUM.*HIGH/i.test(r.newEvents[0].reason),
    "D: reason mentions transition",
  );
  arms = r.arms;

  // E) repeated HIGH does not duplicate
  r = evaluateAlerts({
    followed: f,
    observations: [{ mint, riskLevel: "HIGH" }],
    arms,
    now: now + 3000,
  });
  assert(r.newEvents.length === 0, "E: repeated HIGH no duplicate");
  arms = r.arms;

  // F) HIGH → MEDIUM re-arms
  r = evaluateAlerts({
    followed: f,
    observations: [{ mint, riskLevel: "MEDIUM" }],
    arms,
    now: now + 4000,
  });
  assert(r.newEvents.length === 0, "F: HIGH→MEDIUM no alert");
  assert(r.arms[`${mint}:RISK_BECAME_HIGH`]?.active === false, "F: re-armed");
  arms = r.arms;

  // G) later MEDIUM → HIGH fires again (outside cooldown)
  r = evaluateAlerts({
    followed: f,
    observations: [{ mint, riskLevel: "HIGH" }],
    arms,
    now: now + 4000 + ALERT_COOLDOWN_MS + 1,
  });
  assert(r.newEvents.length === 1, "G: later MEDIUM→HIGH fires again");
  arms = r.arms;

  // H) concentration inactive → active fires
  const inactiveEarly = assessEarlySignal(
    token(),
    enrich({ concentrationTrend: null, holderGrowth: null }),
  );
  assert(
    !inactiveEarly.signals.some((s) => s.id === "concentration_rising"),
    "H setup: inactive",
  );
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        token: token(),
        enrichment: enrich({ concentrationTrend: null }),
        early: inactiveEarly,
      },
    ],
    arms,
    now: now + 10_000,
  });
  arms = r.arms;
  const risingEarly = assessEarlySignal(
    token(),
    enrich({
      concentrationTrend: trendRising(),
      holderGrowth: null,
      riskLevel: "MEDIUM",
    }),
  );
  assert(
    risingEarly.signals.some((s) => s.id === "concentration_rising"),
    "H setup: concentration_rising active via Early Signals",
  );
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        token: token(),
        enrichment: enrich({ concentrationTrend: trendRising() }),
        early: risingEarly,
      },
    ],
    arms,
    now: now + 11_000,
  });
  assert(
    r.newEvents.some((e) => e.type === "CONCENTRATION_RISING"),
    "H: concentration inactive→active fires",
  );
  arms = r.arms;

  // I) repeated concentration active does not duplicate
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        early: risingEarly,
        enrichment: enrich({ concentrationTrend: trendRising() }),
      },
    ],
    arms,
    now: now + 12_000,
  });
  assert(
    !r.newEvents.some((e) => e.type === "CONCENTRATION_RISING"),
    "I: repeated concentration no duplicate",
  );
  arms = r.arms;

  // J) structure building transition fires informational
  const noStruct = assessEarlySignal(token(), enrich({ holderGrowth: null }));
  r = evaluateAlerts({
    followed: f,
    observations: [{ mint, early: noStruct, enrichment: enrich() }],
    arms,
    now: now + 20_000,
  });
  arms = r.arms;
  const structEarly = assessEarlySignal(
    token(),
    enrich({
      holderGrowth: growth(),
      concentrationTrend: trendImproving(),
      riskLevel: "MEDIUM",
    }),
  );
  assert(
    structEarly.signals.some((s) => s.id === "structure_building"),
    "J setup: structure_building active",
  );
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        early: structEarly,
        enrichment: enrich({
          holderGrowth: growth(),
          concentrationTrend: trendImproving(),
        }),
      },
    ],
    arms,
    now: now + 21_000,
  });
  const structEv = r.newEvents.find((e) => e.type === "STRUCTURE_BUILDING");
  assert(structEv, "J: structure building fires");
  assert(structEv.priority === "INFORMATIONAL", "J: INFORMATIONAL");
  arms = r.arms;

  // K) whale distribution fires only when Detail facts supplied
  const whaleFacts = {
    status: "ready",
    events: [
      {
        signature: "sig1",
        signatures: ["sig1"],
        observedAt: now,
        firstObservedAt: now,
        lastObservedAt: now,
        kind: "distribution",
        summary: "dist",
        line: "dist",
        ageLabel: "1h",
        wallet: "Wallet111",
        walletShort: "Wall…",
        supplyPct: 8,
        tokenAmountUi: 1000,
        usdValue: 50_000,
        buyUsd: 0,
        sellUsd: 50_000,
        netUsd: -50_000,
        buyCount: 0,
        sellCount: 1,
        transferCount: 0,
        aggregated: false,
        isTopHolder: true,
        isTop10Holder: true,
        isSwap: true,
        major: true,
        riskRelevant: true,
        rank: 1,
      },
    ],
    smartMoneyAvailable: false,
    analyzedAccounts: 1,
    updatedAt: now,
    errorMessage: null,
  };
  const whaleEarly = assessEarlySignal(token(), enrich({ riskLevel: "MEDIUM" }), {
    includeWhale: true,
    whaleActivity: whaleFacts,
  });
  assert(
    whaleEarly.signals.some((s) => s.id === "whale_distribution_alert"),
    "K setup: whale_distribution_alert present",
  );
  // First: without includeWhale — must not arm/fire LARGE_HOLDER
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        early: whaleEarly,
        includeWhale: false,
        whaleActivity: whaleFacts,
      },
    ],
    arms,
    now: now + 30_000,
  });
  assert(
    !r.newEvents.some((e) => e.type === "LARGE_HOLDER_DISTRIBUTION"),
    "K: no whale alert without includeWhale",
  );
  arms = r.arms;

  // Baseline inactive whale then active with includeWhale
  const noWhaleEarly = assessEarlySignal(
    token(),
    enrich({ riskLevel: "MEDIUM" }),
    {
      includeWhale: true,
      whaleActivity: {
        status: "ready",
        events: [],
        smartMoneyAvailable: false,
        analyzedAccounts: 0,
        updatedAt: now,
        errorMessage: null,
      },
    },
  );
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        early: noWhaleEarly,
        includeWhale: true,
        whaleActivity: {
          status: "ready",
          events: [],
          smartMoneyAvailable: false,
          analyzedAccounts: 0,
          updatedAt: now,
          errorMessage: null,
        },
      },
    ],
    arms,
    now: now + 31_000,
  });
  arms = r.arms;
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        early: whaleEarly,
        includeWhale: true,
        whaleActivity: whaleFacts,
      },
    ],
    arms,
    now: now + 32_000,
  });
  assert(
    r.newEvents.some((e) => e.type === "LARGE_HOLDER_DISTRIBUTION"),
    "K: whale alert when Detail facts supplied",
  );
  arms = r.arms;

  // L) no whale facts = no whale alert (includeWhale but empty / inactive first obs)
  const mint2 = "Alert222222222222222222222222222222222222";
  r = evaluateAlerts({
    followed: [followed(mint2)],
    observations: [
      {
        mint: mint2,
        early: noWhaleEarly,
        includeWhale: true,
        whaleActivity: null,
      },
    ],
    arms,
    now: now + 33_000,
  });
  assert(
    !r.newEvents.some((e) => e.type === "LARGE_HOLDER_DISTRIBUTION"),
    "L: no whale facts → no whale alert on baseline",
  );
  arms = r.arms;

  // M) liquidity -19% does not fire
  const priorBase = {
    liquidityUsd: 100_000,
    volume24hUsd: 10_000,
    capturedAt: now + 40_000,
  };
  let drop = assessLiquidityDrop({
    liquidityUsd: 81_000, // -19%
    prior: priorBase,
    now: now + 40_000 + 1000,
  });
  assert(!drop.active, "M: -19% not active");
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        liquidityUsd: 100_000,
        prior: { ...priorBase, capturedAt: now + 39_000 },
      },
    ],
    arms,
    now: now + 39_500,
  });
  arms = r.arms; // baseline non-drop
  r = evaluateAlerts({
    followed: f,
    observations: [
      {
        mint,
        liquidityUsd: 81_000,
        prior: priorBase,
      },
    ],
    arms,
    now: now + 41_000,
  });
  assert(
    !r.newEvents.some((e) => e.type === "LIQUIDITY_DROP"),
    "M: -19% does not fire LIQUIDITY_DROP",
  );
  arms = r.arms;

  // N) liquidity -21% but <$8k absolute does not fire
  drop = assessLiquidityDrop({
    liquidityUsd: 7900,
    prior: {
      liquidityUsd: 10_000,
      volume24hUsd: 1_000,
      capturedAt: now + 50_000,
    },
    now: now + 50_500,
  });
  assert(!drop.active, "N: -21% but abs <$8k not active");
  assert(RADAR_LIQ_MOVE_USD === 8_000, "N: radar floor $8k");
  assert(RADAR_LIQ_MOVE_PCT === 20, "N: radar pct 20");

  // O) liquidity <=-20% and >=$8k drop fires
  const priorLiq = {
    liquidityUsd: 100_000,
    volume24hUsd: 10_000,
    capturedAt: now + 60_000,
  };
  r = evaluateAlerts({
    followed: f,
    observations: [
      { mint, liquidityUsd: 100_000, prior: { ...priorLiq, capturedAt: now + 59_000 } },
    ],
    arms,
    now: now + 59_500,
  });
  arms = r.arms;
  r = evaluateAlerts({
    followed: f,
    observations: [{ mint, liquidityUsd: 75_000, prior: priorLiq }],
    arms,
    now: now + 60_500,
  });
  assert(
    r.newEvents.some((e) => e.type === "LIQUIDITY_DROP"),
    "O: -25% and $25k drop fires",
  );
  arms = r.arms;

  // P) first observed active liquidity-drop state creates baseline only
  const mint3 = "Alert333333333333333333333333333333333333";
  r = evaluateAlerts({
    followed: [followed(mint3)],
    observations: [
      {
        mint: mint3,
        liquidityUsd: 70_000,
        prior: {
          liquidityUsd: 100_000,
          volume24hUsd: 5_000,
          capturedAt: now + 70_000,
        },
      },
    ],
    arms,
    now: now + 70_500,
  });
  assert(
    !r.newEvents.some((e) => e.type === "LIQUIDITY_DROP"),
    "P: first active liquidity drop = baseline only",
  );
  arms = r.arms;

  // Q) cooldown prevents flap duplicate
  const mintQ = "AlertQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ";
  r = evaluateAlerts({
    followed: [followed(mintQ)],
    observations: [{ mint: mintQ, riskLevel: "MEDIUM" }],
    arms: {},
    now: now + 80_000,
  });
  let armsQ = r.arms;
  r = evaluateAlerts({
    followed: [followed(mintQ)],
    observations: [{ mint: mintQ, riskLevel: "HIGH" }],
    arms: armsQ,
    now: now + 81_000,
  });
  assert(r.newEvents.length === 1, "Q setup: first HIGH fire");
  armsQ = r.arms;
  r = evaluateAlerts({
    followed: [followed(mintQ)],
    observations: [{ mint: mintQ, riskLevel: "MEDIUM" }],
    arms: armsQ,
    now: now + 82_000,
  });
  armsQ = r.arms;
  r = evaluateAlerts({
    followed: [followed(mintQ)],
    observations: [{ mint: mintQ, riskLevel: "HIGH" }],
    arms: armsQ,
    now: now + 83_000, // within 6h cooldown
  });
  assert(r.newEvents.length === 0, "Q: cooldown prevents flap duplicate");
  assert(
    r.arms[`${mintQ}:RISK_BECAME_HIGH`]?.active === true,
    "Q: state still updates under cooldown",
  );

  // R) different followed mints remain independent
  const mintR1 = "AlertR11111111111111111111111111111111111";
  const mintR2 = "AlertR22222222222222222222222222222222222";
  r = evaluateAlerts({
    followed: [followed(mintR1), followed(mintR2)],
    observations: [
      { mint: mintR1, riskLevel: "MEDIUM" },
      { mint: mintR2, riskLevel: "MEDIUM" },
    ],
    arms: {},
    now: now + 90_000,
  });
  let armsR = r.arms;
  r = evaluateAlerts({
    followed: [followed(mintR1), followed(mintR2)],
    observations: [
      { mint: mintR1, riskLevel: "HIGH" },
      { mint: mintR2, riskLevel: "MEDIUM" },
    ],
    arms: armsR,
    now: now + 91_000,
  });
  assert(
    r.newEvents.filter((e) => e.type === "RISK_BECAME_HIGH").length === 1,
    "R: only mintR1 fires",
  );
  assert(r.newEvents[0].mint === mintR1, "R: independent mint");

  // S) unfollowed token does not generate new alert
  r = evaluateAlerts({
    followed: [],
    observations: [{ mint: mintR1, riskLevel: "HIGH" }],
    arms: armsR,
    now: now + 92_000,
  });
  assert(r.newEvents.length === 0, "S: unfollowed generates nothing");

  // T) storage capped at 50
  assert(ALERT_MAX_EVENTS === 50, "T: max 50");
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: `e${i}`,
    mint: "x",
    type: i < 20 ? "STRUCTURE_BUILDING" : "RISK_BECAME_HIGH",
    priority: i < 20 ? "INFORMATIONAL" : "CRITICAL",
    reason: "t",
    createdAt: now + i,
    read: false,
  }));
  const trimmed = trimAlertEvents(many);
  assert(trimmed.length === 50, "T: trimmed to 50");
  assert(
    trimmed.filter((e) => e.priority === "INFORMATIONAL").length < 20,
    "T: informational dropped first",
  );

  // U already checked via source
  // V) missing data does not create alerts
  r = evaluateAlerts({
    followed: [followed("Miss1")],
    observations: [
      { mint: "Miss1", riskLevel: "UNKNOWN", enrichment: enrich({ status: "idle", riskLevel: null }) },
    ],
    arms: {},
    now: now + 100_000,
  });
  assert(r.newEvents.length === 0, "V: UNKNOWN risk no alert");
  assert(
    !r.arms["Miss1:RISK_BECAME_HIGH"]?.baselined,
    "V: UNKNOWN does not baseline risk",
  );

  // Priority map sanity
  assert(ALERT_PRIORITY.RISK_BECAME_HIGH === "CRITICAL", "priority CRITICAL");
  assert(
    ALERT_PRIORITY.CONCENTRATION_RISING === "IMPORTANT",
    "priority IMPORTANT conc",
  );
  assert(
    ALERT_PRIORITY.STRUCTURE_BUILDING === "INFORMATIONAL",
    "priority INFO struct",
  );

  // Live cap untouched
  assert(DISCOVERY_TARGET === 40, "Live universe cap remains 40");

  // Persistence round-trip for events
  resetAlertStorageForTests();
  appendAlertEvents([], [
    {
      id: "persist1",
      mint,
      type: "RISK_BECAME_HIGH",
      priority: "CRITICAL",
      reason: "Risk changed from MEDIUM to HIGH.",
      createdAt: now,
      read: false,
    },
  ]);
  assert(loadAlertEvents().length === 1, "events persist");
  saveAlertEvents([]);

  console.log("verify-alerts-v1: PASS (A–W)");
  await server.close();
  process.exit(0);
} catch (err) {
  console.error("verify-alerts-v1: FAIL");
  console.error(err);
  await server.close();
  process.exit(1);
}
