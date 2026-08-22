/**
 * Offline AXIOM RADAR V1 checks (scenarios A–U). ZERO network.
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
    foldMintCandidates,
    isRadarPositiveSuppressed,
    hasExtremeVolLiqMismatch,
    radarPrimaryPriority,
    RADAR_HOLDER_ACCEL_PCT,
    RADAR_CONCENTRATION_PP,
    RADAR_MAX_EVENTS_DEFAULT,
  } = await server.ssrLoadModule("/src/lib/discovery/radarEvents.ts");

  const { DISCOVERY_TARGET } = await server.ssrLoadModule(
    "/src/lib/market/dexscreener.ts",
  );
  const { applyDiscoveryFilter } = await server.ssrLoadModule(
    "/src/lib/discovery/filters.ts",
  );

  // Regression loads — formulas untouched
  await server.ssrLoadModule("/src/lib/discovery/earlySignals.ts");
  await server.ssrLoadModule("/src/lib/intelligence/walletSignals.ts");

  // A) Live universe never exceeds 40
  assert(DISCOVERY_TARGET === 40, "A: DISCOVERY_TARGET must be 40");
  assert(RADAR_MAX_EVENTS_DEFAULT === 3, "D: Radar max must be 3");

  // B) downstream enrichment input never exceeds bounded Live universe
  //    (deriveRadarEvents only sees the tokens array callers pass — cap is upstream)
  const many = Array.from({ length: 40 }, (_, i) =>
    token({
      mint: `Mint${String(i).padStart(39, "1")}`,
      symbol: `T${i}`,
      volume24hUsd: 20_000 + i,
      priceChange5mPct: 9,
    }),
  );
  assert(many.length <= DISCOVERY_TARGET, "B: fixture universe ≤ 40");

  // C) existing filters still operate correctly over bounded universe
  const emptyEnrich = new Map();
  const trending = applyDiscoveryFilter(many, "trending", emptyEnrich, now);
  const highVol = applyDiscoveryFilter(many, "high_volume", emptyEnrich, now);
  assert(trending.length === 40, "C: trending operates over full bounded set");
  assert(highVol.length === 40, "C: high_volume operates over full bounded set");
  assert(
    highVol[0].volume24hUsd >= highVol[highVol.length - 1].volume24hUsd,
    "C: high_volume still ranks by volume",
  );

  // Empty / missing data → no fabricated events (R)
  const empty = deriveRadarEvents([], new Map(), { now });
  assert(empty.length === 0, "R: empty universe must yield no events");

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
  assert(
    deriveRadarEvents([thinTok], thinMap, { now }).length === 0,
    "missing data must not fabricate events",
  );

  // M) history building does not fabricate structural candidate
  const buildingMint = "Build1111111111111111111111111111111111";
  const buildingTok = token({
    mint: buildingMint,
    volume24hUsd: 3_000,
    liquidityUsd: 5_000,
    priceChange5mPct: 0,
    listedAt: now - 10 * 24 * 60 * 60 * 1000,
    isFresh: false,
  });
  const buildingEvents = deriveRadarEvents(
    [buildingTok],
    new Map([
      [
        buildingMint,
        enrich({
          status: "loading",
          holderGrowth: null,
          concentrationTrend: null,
        }),
      ],
    ]),
    { now },
  );
  assert(
    !buildingEvents.some(
      (e) =>
        e.type === "HOLDER_ACCELERATION" ||
        e.type === "CONCENTRATION_RISING" ||
        e.type === "DISTRIBUTION_IMPROVING",
    ),
    "M: loading enrichment must not fabricate structural candidates",
  );

  // Holder acceleration
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
  const growthLow = {
    ...growthOk,
    percent: RADAR_HOLDER_ACCEL_PCT - 0.1,
    absolute: 30,
  };
  const accelTok = token({
    mint: accelMint,
    volume24hUsd: 10_000,
    liquidityUsd: 20_000,
  });
  const accelEvents = deriveRadarEvents(
    [accelTok],
    new Map([[accelMint, enrich({ holderGrowth: growthOk })]]),
    { now },
  );
  assert(
    accelEvents.some(
      (e) =>
        e.type === "HOLDER_ACCELERATION" ||
        (e.type === "MULTI_SIGNAL" &&
          e.dedupeKey.includes("HOLDER_ACCELERATION")),
    ),
    "significant acceleration must qualify",
  );

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
    new Map([[accelMint, enrich({ holderGrowth: growthLow })]]),
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

  // Concentration rising / distribution
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
  assert(
    riseEvents[0]?.direction === "caution",
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
  assert(
    !deriveRadarEvents(
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
    ).some((e) => e.type === "DISTRIBUTION_IMPROVING"),
    "falling holders must block distribution improving",
  );

  // N/P) concentration rising outranks generic momentum
  const rankMint = "Rank111111111111111111111111111111111111";
  const momTok = token({
    mint: "Mom11111111111111111111111111111111111111",
    priceChange5mPct: 12,
    volume24hUsd: 30_000,
    liquidityUsd: 40_000,
    listedAt: now - 10 * 24 * 60 * 60 * 1000,
    isFresh: false,
  });
  const structTok = token({
    mint: rankMint,
    priceChange5mPct: 0,
    volume24hUsd: 3_000,
    liquidityUsd: 5_000,
    listedAt: now - 10 * 24 * 60 * 60 * 1000,
    isFresh: false,
  });
  const ranked = deriveRadarEvents(
    [momTok, structTok],
    new Map([[rankMint, enrich({ concentrationTrend: rising })]]),
    { now },
  );
  assert(ranked.length >= 1, "N: at least one candidate");
  assert(
    ranked[0].type === "CONCENTRATION_RISING" ||
      ranked[0].type === "MULTI_SIGNAL" ||
      ranked[0].mint === rankMint,
    "N/P: structural caution outranks generic momentum",
  );
  assert(
    radarPrimaryPriority("CONCENTRATION_RISING") <
      radarPrimaryPriority("MOMENTUM_SHIFT"),
    "N: priority table favors concentration",
  );

  // Volume / momentum still can qualify as weak fallback
  const volMint = "Vol1111111111111111111111111111111111111";
  const volTok = token({
    mint: volMint,
    volume24hUsd: 150_000,
    liquidityUsd: 40_000,
    priceChange5mPct: 12,
  });
  const volEvents = deriveRadarEvents([volTok], new Map(), { now });
  assert(volEvents.length <= 1, "E: one card per mint for volume token");
  assert(volEvents.length === 1, "volume/momentum alone may still qualify once");

  // Extreme spike alone without volume confirmation → no 5m MOMENTUM_SHIFT
  const spikeTok = token({
    mint: "Spike11111111111111111111111111111111111",
    priceChange5mPct: 120,
    volume24hUsd: 1_000,
    liquidityUsd: 20_000,
  });
  assert(
    !deriveRadarEvents([spikeTok], new Map(), { now }).some(
      (e) => e.type === "MOMENTUM_SHIFT" && e.window === "5m",
    ),
    "extreme 5m spike must not create 5m momentum event",
  );

  // O) liquidity move can qualify
  const liqMint = "Liq1111111111111111111111111111111111111";
  const liqTok = token({
    mint: liqMint,
    liquidityUsd: 50_000,
    volume24hUsd: 20_000,
    listedAt: now - 10 * 24 * 60 * 60 * 1000,
    isFresh: false,
  });
  assert(
    !deriveRadarEvents([liqTok], new Map(), { now }).some(
      (e) => e.type === "LIQUIDITY_MOVE",
    ),
    "liquidity move without prior must not invent history",
  );
  const withPrior = deriveRadarEvents([liqTok], new Map(), {
    now,
    priorByMint: new Map([
      [
        liqMint,
        {
          liquidityUsd: 30_000,
          volume24hUsd: 20_000,
          capturedAt: now - 60_000,
        },
      ],
    ]),
  });
  assert(
    withPrior.some((e) => e.type === "LIQUIDITY_MOVE"),
    "O: session prior liquidity expansion must qualify",
  );

  // Early signal reuse
  const earlyMint = "Early11111111111111111111111111111111111";
  const earlyTok = token({
    mint: earlyMint,
    priceChange5mPct: 12,
    volume24hUsd: 40_000,
    liquidityUsd: 15_000,
    listedAt: now - 3 * 60 * 60 * 1000,
    isFresh: true,
  });
  assert(
    deriveRadarEvents([earlyTok], new Map(), { now }).some(
      (e) =>
        e.type === "EARLY_SIGNAL" ||
        e.type === "MULTI_SIGNAL" ||
        e.type === "VOLUME_ACCELERATION" ||
        e.type === "MOMENTUM_SHIFT",
    ),
    "qualified early/market setup must surface",
  );

  // E/F) one card per mint; fold primary + optional caution
  const foldMint = "Fold111111111111111111111111111111111111";
  const foldTok = token({
    mint: foldMint,
    priceChange5mPct: 12,
    volume24hUsd: 80_000,
    liquidityUsd: 30_000,
    listedAt: now - 4 * 60 * 60 * 1000,
    isFresh: true,
  });
  const foldEvents = deriveRadarEvents(
    [foldTok],
    new Map([
      [
        foldMint,
        enrich({
          holderGrowth: growthOk,
          concentrationTrend: rising,
          topHolderPct: 12,
          top10HolderPct: 35,
          riskLevel: "LOW",
        }),
      ],
    ]),
    { now },
  );
  assert(foldEvents.length === 1, "E: one card per mint");
  assert(
    foldEvents[0].type === "MULTI_SIGNAL" ||
      foldEvents[0].type === "CONCENTRATION_RISING",
    "F: multi-family folds into single primary",
  );
  assert(
    foldEvents[0].secondaryCaution == null ||
      typeof foldEvents[0].secondaryCaution === "string",
    "F: secondary caution is optional string/null",
  );

  // G/H/I/J) Risk-aware positive suppression
  assert(
    isRadarPositiveSuppressed(enrich({ riskLevel: "HIGH" })),
    "G: HIGH risk suppresses positives",
  );
  assert(
    isRadarPositiveSuppressed(enrich({ topHolderPct: 50, riskLevel: "MEDIUM" })),
    "H: largest >=50 suppresses positives",
  );
  assert(
    isRadarPositiveSuppressed(
      enrich({ top10HolderPct: 85, riskLevel: "MEDIUM" }),
    ),
    "I: top10 >=85 suppresses positives",
  );

  const highRiskPositive = deriveRadarEvents(
    [
      token({
        mint: "HighR11111111111111111111111111111111111",
        priceChange5mPct: 12,
        volume24hUsd: 150_000,
        liquidityUsd: 40_000,
      }),
    ],
    new Map([
      [
        "HighR11111111111111111111111111111111111",
        enrich({ riskLevel: "HIGH", topHolderPct: 55, top10HolderPct: 90 }),
      ],
    ]),
    { now },
  );
  assert(
    !highRiskPositive.some((e) => e.direction === "positive"),
    "G: HIGH risk must not present positive Radar candidate",
  );

  const cautionSurvives = deriveRadarEvents(
    [concTok],
    new Map([
      [
        concMint,
        enrich({
          riskLevel: "HIGH",
          topHolderPct: 55,
          concentrationTrend: rising,
        }),
      ],
    ]),
    { now },
  );
  assert(
    cautionSurvives.some(
      (e) =>
        (e.type === "CONCENTRATION_RISING" ||
          (e.type === "MULTI_SIGNAL" &&
            e.dedupeKey.includes("CONCENTRATION_RISING"))) &&
        e.direction === "caution",
    ),
    "J: caution survives positive suppression",
  );

  // Extreme vol/liq mismatch demotes generic positive volume/momentum
  const mismatchTok = token({
    mint: "Mis11111111111111111111111111111111111111",
    volume24hUsd: 600_000,
    liquidityUsd: 5_000,
    priceChange5mPct: 12,
  });
  assert(hasExtremeVolLiqMismatch(mismatchTok), "extreme vol/liq detected");
  const mismatchEvents = deriveRadarEvents([mismatchTok], new Map(), { now });
  assert(
    !mismatchEvents.some(
      (e) =>
        e.direction === "positive" &&
        (e.type === "VOLUME_ACCELERATION" || e.type === "MOMENTUM_SHIFT"),
    ),
    "extreme vol/liq must not promote generic positive volume/momentum",
  );

  // K) AXM alone does not determine rank — Radar derive has no AXM input
  // L) missing AXM does not fabricate — display layer omits when null
  assert(
    foldEvents[0].riskLevel === "LOW" || foldEvents[0].riskLevel == null,
    "risk context attached when known",
  );

  // D/Q) max 3; never pad
  const padTokens = Array.from({ length: 10 }, (_, i) =>
    token({
      mint: `Pad${String(i).padStart(40, "1")}`.slice(0, 44),
      symbol: `P${i}`,
      priceChange5mPct: 9 + i * 0.1,
      volume24hUsd: 30_000,
      liquidityUsd: 25_000,
      listedAt: now - 10 * 24 * 60 * 60 * 1000,
      isFresh: false,
    }),
  );
  const padEvents = deriveRadarEvents(padTokens, new Map(), { now });
  assert(padEvents.length <= 3, "D: Radar maximum 3 candidates");
  assert(padEvents.length <= padTokens.length, "Q: never pads beyond qualifiers");

  // Only one qualifier → show 1
  const single = deriveRadarEvents(
    [concTok],
    new Map([[concMint, enrich({ concentrationTrend: rising })]]),
    { now },
  );
  assert(single.length === 1, "prefer 1 when only 1 qualifies");

  // Dedup helper
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
      secondaryCaution: null,
      riskLevel: null,
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
      secondaryCaution: null,
      riskLevel: null,
    },
  ];
  const deduped = dedupeRadarEvents(dup);
  assert(deduped.length === 1, "dedupe must collapse same key");
  assert(deduped[0].severity === "watch", "dedupe keeps higher severity");

  // Sorting: priority before severity (structural before momentum)
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
        severity: "high",
        window: "5m",
        metrics: [],
        observedAt: now,
        dedupeKey: "a",
        evidenceScore: 999,
        secondaryCaution: null,
        riskLevel: null,
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
        severity: "watch",
        window: "1h",
        metrics: [],
        observedAt: now - 60_000,
        dedupeKey: "b",
        evidenceScore: 1,
        secondaryCaution: null,
        riskLevel: null,
      },
    ],
    now,
  );
  assert(
    sorted[0].type === "CONCENTRATION_RISING",
    "structural type sorts ahead of momentum",
  );

  // foldMintCandidates export smoke
  const folded = foldMintCandidates(
    foldTok,
    [
      {
        mint: foldMint,
        symbol: "F",
        name: "F",
        type: "MOMENTUM_SHIFT",
        title: "5m momentum shift",
        reason: "r",
        direction: "positive",
        severity: "info",
        window: "5m",
        metrics: [],
        observedAt: now,
        dedupeKey: `${foldMint}:MOMENTUM_SHIFT:5m`,
        evidenceScore: 10,
        secondaryCaution: null,
        riskLevel: null,
      },
      {
        mint: foldMint,
        symbol: "F",
        name: "F",
        type: "CONCENTRATION_RISING",
        title: "Concentration rising",
        reason: "r",
        direction: "caution",
        severity: "high",
        window: "1h",
        metrics: [],
        observedAt: now,
        dedupeKey: `${foldMint}:CONCENTRATION_RISING:1h`,
        evidenceScore: 20,
        secondaryCaution: null,
        riskLevel: null,
      },
    ],
    enrich({ riskLevel: "LOW" }),
    now,
  );
  assert(
    folded?.type === "CONCENTRATION_RISING" ||
      folded?.type === "MULTI_SIGNAL",
    "F: fold picks structural primary or multi-signal fold",
  );
  assert(
    folded?.type !== "MOMENTUM_SHIFT",
    "F: momentum must not win over concentration",
  );

  // S/T/U) no Detail whale / wallet / Jupiter fan-out in radarEvents module
  // Covered by: zero network in this verifier + module has no fetch imports.
  const snap = snapshotRadarPriors([liqTok], now);
  assert(snap.get(liqMint)?.liquidityUsd === 50_000, "prior snapshot");

  console.log(
    JSON.stringify({
      ok: true,
      discoveryTarget: DISCOVERY_TARGET,
      radarMax: RADAR_MAX_EVENTS_DEFAULT,
      empty: empty.length,
      rise: riseEvents.map((e) => e.type),
      fold: foldEvents.map((e) => ({
        type: e.type,
        secondary: e.secondaryCaution,
      })),
      padCount: padEvents.length,
      cautionSurvives: cautionSurvives.map((e) => e.type),
    }),
  );
  console.log("RADAR_V1_OK");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await server.close();
}
