/**
 * Offline AXIOM RADAR V1 checks. ZERO network.
 * Usage: node scripts/verify-radar-v1.mjs
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

function token(over = {}) {
  return {
    mint: "Radar111111111111111111111111111111111111",
    symbol: "RAD",
    name: "Radar",
    decimals: 6,
    selectable: true,
    priceUsd: 0.02,
    priceChange5mPct: 0,
    priceChange1hPct: 0,
    volume24hUsd: 5_000,
    liquidityUsd: 8_000,
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  const {
    deriveRadarEvents,
    dedupeRadarEvents,
    sortRadarEvents,
    snapshotRadarPriors,
    RADAR_HOLDER_ACCEL_PCT,
    RADAR_CONCENTRATION_PP,
  } = await server.ssrLoadModule("/src/lib/discovery/radarEvents.ts");

  // Regression loads — formulas untouched
  await server.ssrLoadModule("/src/lib/discovery/earlySignals.ts");
  await server.ssrLoadModule("/src/lib/intelligence/walletSignals.ts");

  // 1) Empty / missing data → no fabricated events
  const empty = deriveRadarEvents([], new Map(), { now });
  assert(empty.length === 0, "empty universe must yield no events");

  const thinMap = new Map([
    [
      "Thin1111111111111111111111111111111111111",
      enrich({ status: "unavailable", holderCount: null }),
    ],
  ]);
  const thinTok = token({
    mint: "Thin1111111111111111111111111111111111111",
    volume24hUsd: null,
    liquidityUsd: null,
    priceChange5mPct: null,
  });
  const thinEvents = deriveRadarEvents([thinTok], thinMap, { now });
  assert(thinEvents.length === 0, "missing data must not fabricate events");

  // 2) Holder acceleration qualification + threshold boundary
  const accelMint = "Accel11111111111111111111111111111111111";
  const growthOk = {
    absolute: 80,
    percent: RADAR_HOLDER_ACCEL_PCT,
    fromAt: now - 60 * 60_000,
    toAt: now,
    fromCount: 400,
    toCount: 480,
    window: "1h",
    actualElapsedMs: 60 * 60_000,
  };
  const growthLow = { ...growthOk, percent: RADAR_HOLDER_ACCEL_PCT - 0.1, absolute: 30 };
  const accelTok = token({ mint: accelMint, volume24hUsd: 10_000, liquidityUsd: 20_000 });
  const accelMap = new Map([
    [accelMint, enrich({ holderGrowth: growthOk })],
  ]);
  const accelEvents = deriveRadarEvents([accelTok], accelMap, { now });
  assert(
    accelEvents.some(
      (e) =>
        e.type === "HOLDER_ACCELERATION" ||
        (e.type === "MULTI_SIGNAL" &&
          e.dedupeKey.includes("HOLDER_ACCELERATION")),
    ),
    "significant acceleration must qualify",
  );

  const lowMap = new Map([[accelMint, enrich({ holderGrowth: growthLow })]]);
  const lowEvents = deriveRadarEvents(
    [
      token({
        mint: accelMint,
        volume24hUsd: 10_000,
        liquidityUsd: 20_000,
        priceChange5mPct: 0,
        listedAt: now - 10 * 24 * 60 * 60 * 1000,
        isFresh: false,
      }),
    ],
    lowMap,
    { now },
  );
  assert(
    !lowEvents.some(
      (e) =>
        e.type === "HOLDER_ACCELERATION" ||
        (e.type === "MULTI_SIGNAL" &&
          e.dedupeKey.includes("HOLDER_ACCELERATION")),
    ),
    "below acceleration threshold must not qualify",
  );

  // 3) Concentration rising / distribution improving
  const concMint = "Conc111111111111111111111111111111111111";
  const rising = {
    available: true,
    largestTrend: "increasing",
    top10Trend: "stable",
    largestDeltaPp: RADAR_CONCENTRATION_PP,
    top10DeltaPp: 0.2,
    preferredWindow: "1h",
    comparedAt: now - 30 * 60_000,
    signals: ["Ownership becoming more concentrated"],
  };
  const improving = {
    available: true,
    largestTrend: "stable",
    top10Trend: "decreasing",
    largestDeltaPp: 0.1,
    top10DeltaPp: -RADAR_CONCENTRATION_PP,
    preferredWindow: "1h",
    comparedAt: now - 30 * 60_000,
    signals: ["Distribution becoming healthier"],
  };
  const concTok = token({
    mint: concMint,
    listedAt: now - 10 * 24 * 60 * 60 * 1000,
    isFresh: false,
    volume24hUsd: 3_000,
    liquidityUsd: 2_000,
    priceChange5mPct: 0,
  });
  const riseEvents = deriveRadarEvents(
    [concTok],
    new Map([[concMint, enrich({ concentrationTrend: rising })]]),
    { now },
  );
  assert(
    riseEvents.some(
      (e) =>
        e.type === "CONCENTRATION_RISING" ||
        (e.type === "MULTI_SIGNAL" &&
          e.dedupeKey.includes("CONCENTRATION_RISING")),
    ),
    "material concentration rise must qualify",
  );
  const riseHit = riseEvents.find(
    (e) =>
      e.type === "CONCENTRATION_RISING" ||
      (e.type === "MULTI_SIGNAL" &&
        e.dedupeKey.includes("CONCENTRATION_RISING")),
  );
  assert(
    riseHit?.direction === "caution" ||
      (riseHit?.type === "MULTI_SIGNAL" && riseHit.direction === "caution"),
    "concentration rising is caution",
  );

  const improveEvents = deriveRadarEvents(
    [concTok],
    new Map([[concMint, enrich({ concentrationTrend: improving })]]),
    { now },
  );
  assert(
    improveEvents.some(
      (e) =>
        e.type === "DISTRIBUTION_IMPROVING" ||
        (e.type === "MULTI_SIGNAL" &&
          e.dedupeKey.includes("DISTRIBUTION_IMPROVING")),
    ),
    "distribution improving must qualify",
  );

  // Falling holders block DISTRIBUTION_IMPROVING
  const fallingGrowth = {
    absolute: -40,
    percent: -8,
    fromAt: now - 60 * 60_000,
    toAt: now,
    fromCount: 500,
    toCount: 460,
    window: "1h",
    actualElapsedMs: 60 * 60_000,
  };
  const blocked = deriveRadarEvents(
    [concTok],
    new Map([
      [
        concMint,
        enrich({
          concentrationTrend: improving,
          holderGrowth: fallingGrowth,
        }),
      ],
    ]),
    { now },
  );
  assert(
    !blocked.some((e) => e.type === "DISTRIBUTION_IMPROVING"),
    "falling holders must block distribution improving",
  );

  // 4) Volume / momentum
  const volMint = "Vol1111111111111111111111111111111111111";
  const volTok = token({
    mint: volMint,
    volume24hUsd: 150_000,
    liquidityUsd: 40_000,
    priceChange5mPct: 12,
  });
  const volEvents = deriveRadarEvents([volTok], new Map(), { now });
  assert(
    volEvents.some(
      (e) =>
        e.type === "VOLUME_ACCELERATION" ||
        (e.type === "MULTI_SIGNAL" &&
          e.dedupeKey.includes("VOLUME_ACCELERATION")),
    ),
    "elevated volume+momentum must qualify",
  );
  assert(
    volEvents.some(
      (e) =>
        e.type === "MOMENTUM_SHIFT" ||
        e.type === "MULTI_SIGNAL" ||
        e.type === "VOLUME_ACCELERATION" ||
        e.type === "EARLY_SIGNAL",
    ),
    "momentum, volume, early, or multi must appear",
  );

  // Extreme spike alone without volume confirmation → no MOMENTUM_SHIFT from 5m path
  const spikeTok = token({
    mint: "Spike11111111111111111111111111111111111",
    priceChange5mPct: 120,
    volume24hUsd: 1_000,
    liquidityUsd: 20_000,
  });
  const spikeEvents = deriveRadarEvents([spikeTok], new Map(), { now });
  assert(
    !spikeEvents.some((e) => e.type === "MOMENTUM_SHIFT" && e.window === "5m"),
    "extreme 5m spike must not create 5m momentum event",
  );

  // 5) Liquidity move requires session prior — no fabricated history
  const liqMint = "Liq1111111111111111111111111111111111111";
  const liqTok = token({
    mint: liqMint,
    liquidityUsd: 50_000,
    volume24hUsd: 20_000,
    listedAt: now - 10 * 24 * 60 * 60 * 1000,
    isFresh: false,
  });
  const noPrior = deriveRadarEvents([liqTok], new Map(), { now });
  assert(
    !noPrior.some(
      (e) =>
        e.type === "LIQUIDITY_MOVE" ||
        (e.type === "MULTI_SIGNAL" && e.dedupeKey.includes("LIQUIDITY_MOVE")),
    ),
    "liquidity move without prior must not invent history",
  );

  const priors = new Map([
    [
      liqMint,
      {
        liquidityUsd: 30_000,
        volume24hUsd: 20_000,
        capturedAt: now - 60_000,
      },
    ],
  ]);
  const withPrior = deriveRadarEvents([liqTok], new Map(), {
    now,
    priorByMint: priors,
  });
  assert(
    withPrior.some(
      (e) =>
        e.type === "LIQUIDITY_MOVE" ||
        (e.type === "MULTI_SIGNAL" && e.dedupeKey.includes("LIQUIDITY_MOVE")),
    ),
    "session prior liquidity expansion must qualify",
  );

  // 6) Early signal reuse
  const earlyMint = "Early11111111111111111111111111111111111";
  const earlyTok = token({
    mint: earlyMint,
    priceChange5mPct: 12,
    volume24hUsd: 40_000,
    liquidityUsd: 15_000,
    listedAt: now - 3 * 60 * 60 * 1000,
    isFresh: true,
  });
  const earlyEvents = deriveRadarEvents([earlyTok], new Map(), { now });
  assert(
    earlyEvents.some(
      (e) => e.type === "EARLY_SIGNAL" || e.type === "MULTI_SIGNAL",
    ),
    "qualified early setup must surface",
  );

  // 7) Deduplication
  const dup = [
    {
      id: "a",
      mint: "m",
      symbol: "A",
      name: "A",
      type: "MOMENTUM_SHIFT",
      title: "t",
      reason: "r",
      direction: "positive",
      severity: "info",
      window: "5m",
      metrics: [],
      observedAt: now,
      dedupeKey: "m:MOMENTUM_SHIFT:5m",
      evidenceScore: 10,
    },
    {
      id: "b",
      mint: "m",
      symbol: "A",
      name: "A",
      type: "MOMENTUM_SHIFT",
      title: "t2",
      reason: "r2",
      direction: "positive",
      severity: "watch",
      window: "5m",
      metrics: [],
      observedAt: now,
      dedupeKey: "m:MOMENTUM_SHIFT:5m",
      evidenceScore: 5,
    },
  ];
  const deduped = dedupeRadarEvents(dup);
  assert(deduped.length === 1, "dedupe must collapse same key");
  assert(deduped[0].severity === "watch", "dedupe keeps higher severity");

  // 8) Sorting: severity before freshness before evidence — not price gain
  const sorted = sortRadarEvents(
    [
      {
        id: "1",
        mint: "a",
        symbol: "A",
        name: "A",
        type: "MOMENTUM_SHIFT",
        title: "info",
        reason: "r",
        direction: "positive",
        severity: "info",
        window: "5m",
        metrics: [],
        observedAt: now,
        dedupeKey: "a",
        evidenceScore: 999,
      },
      {
        id: "2",
        mint: "b",
        symbol: "B",
        name: "B",
        type: "CONCENTRATION_RISING",
        title: "crit",
        reason: "r",
        direction: "caution",
        severity: "critical",
        window: "1h",
        metrics: [],
        observedAt: now - 60_000,
        dedupeKey: "b",
        evidenceScore: 1,
      },
    ],
    now,
  );
  assert(sorted[0].severity === "critical", "critical sorts first");

  // 9) Multi-signal when independent families combine
  const multiMint = "Multi11111111111111111111111111111111111";
  const multiTok = token({
    mint: multiMint,
    priceChange5mPct: 12,
    volume24hUsd: 80_000,
    liquidityUsd: 30_000,
    listedAt: now - 4 * 60 * 60 * 1000,
    isFresh: true,
  });
  const multiEvents = deriveRadarEvents(
    [multiTok],
    new Map([
      [
        multiMint,
        enrich({
          holderGrowth: growthOk,
          topHolderPct: 12,
          top10HolderPct: 35,
          riskLevel: "LOW",
        }),
      ],
    ]),
    { now },
  );
  assert(
    multiEvents.some((e) => e.type === "MULTI_SIGNAL") ||
      multiEvents.length >= 2,
    "multi-family activity should combine or list distinct events",
  );

  // snapshot helper
  const snap = snapshotRadarPriors([liqTok], now);
  assert(snap.get(liqMint)?.liquidityUsd === 50_000, "prior snapshot");

  console.log(
    JSON.stringify({
      ok: true,
      empty: empty.length,
      accel: accelEvents.map((e) => e.type),
      rising: riseEvents.map((e) => e.type),
      vol: volEvents.map((e) => e.type),
      liq: withPrior.map((e) => e.type),
      early: earlyEvents.map((e) => e.type),
      multi: multiEvents.map((e) => e.type),
    }),
  );
  console.log("RADAR_V1_OK");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await server.close();
}
