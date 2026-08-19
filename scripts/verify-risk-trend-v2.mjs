/**
 * Offline checks for Risk Analysis V2 Step 2 (holder trend → risk).
 * ZERO network. Usage: node scripts/verify-risk-trend-v2.mjs
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

function baseMarket() {
  return {
    priceUsd: 0.01,
    marketCapUsd: 100_000,
    fdvUsd: 100_000,
    liquidityUsd: 50_000,
    priceChange5mPct: 0,
    priceChange1hPct: 0,
    priceChange24hPct: 0,
    volume24hUsd: 20_000,
    listedAt: now - 30 * 86_400_000,
    ageMs: 30 * 86_400_000,
    available: true,
  };
}

function baseSecurity(over = {}) {
  return {
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    decimals: 6,
    supplyRaw: null,
    topHolderPct: 12,
    top10HolderPct: 40,
    holderCount: 1000,
    holdersAvailable: true,
    authoritiesAvailable: true,
    holdersStatus: "ready",
    holdersPending: false,
    holdersError: null,
    ...over,
  };
}

function baseTrading() {
  return {
    routeAvailable: true,
    priceImpactPct: 0.3,
    priceImpactLevel: "low",
    veryNewTokenWarning: false,
  };
}

function growthDelta(over) {
  return {
    window: "1h",
    absolute: 0,
    percent: 0,
    fromAt: now - 3600_000,
    fromCount: 1000,
    toCount: 1000,
    line: "",
    detailLine: "",
    ...over,
  };
}

function holderIntel({
  snapshotCount = 5,
  recordedMs = 3600_000,
  growthAvailable = true,
  whaleAvailable = true,
  building = false,
  deltas = [],
  largestTrend = "stable",
  top10Trend = "stable",
  largestDeltaPp = 0.1,
  top10DeltaPp = 0.1,
  preferredWindow = "1h",
} = {}) {
  return {
    growth: {
      available: growthAvailable,
      building,
      currentCount: deltas[0]?.toCount ?? 1000,
      deltas,
      primaryLine: null,
      recordedMs,
      statusLine: null,
    },
    whale: {
      available: whaleAvailable,
      building,
      largestTrend,
      top10Trend,
      largestDeltaPp,
      top10DeltaPp,
      comparedAt: now - 3600_000,
      preferredWindow,
      windows: [],
      signals: [],
      recordedMs,
      statusLine: null,
    },
    interpretations: [],
    recordedMs,
    snapshotCount,
    lastSnapshotAt: now,
  };
}

try {
  const {
    assessTokenRisk,
    isMeaningfulHolderHistory,
    explainTokenRisk,
    assessRiskDataConfidence,
  } = await server.ssrLoadModule("/src/lib/intelligence/index.ts");

  // --- gates ---
  if (
    isMeaningfulHolderHistory(
      holderIntel({ snapshotCount: 2, deltas: [growthDelta({ percent: -30 })] }),
    )
  ) {
    throw new Error("2 snapshots must not be meaningful history");
  }
  if (
    !isMeaningfulHolderHistory(
      holderIntel({
        snapshotCount: 5,
        deltas: [growthDelta({ percent: 1 })],
      }),
    )
  ) {
    throw new Error("mature history should be meaningful");
  }

  // 1) Severe deterioration → HIGH + accurate Why
  const severeIntel = holderIntel({
    deltas: [
      growthDelta({
        window: "1h",
        absolute: -214,
        percent: -21.4,
        fromCount: 1000,
        toCount: 786,
      }),
    ],
    largestTrend: "increasing",
    top10Trend: "increasing",
    largestDeltaPp: 28.8,
    top10DeltaPp: 30.6,
    preferredWindow: "1h",
  });
  const severe = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity({ topHolderPct: 34.3, top10HolderPct: 41.4 }),
    trading: baseTrading(),
    holderIntel: severeIntel,
  });
  if (severe.level !== "HIGH") {
    throw new Error(`severe deterioration expected HIGH got ${severe.level}`);
  }
  if (
    !severe.reasons.some(
      (r) =>
        r.code === "holders_falling_rapidly" &&
        /declined 21\.4% over 1h/.test(r.message),
    )
  ) {
    throw new Error(`missing decline Why: ${JSON.stringify(severe.reasons)}`);
  }
  if (
    !severe.reasons.some(
      (r) =>
        r.code === "largest_holder_share_rising" &&
        /increased by 28\.8pp over 1h/.test(r.message),
    )
  ) {
    throw new Error("missing largest concentration Why");
  }
  if (
    !severe.reasons.some(
      (r) =>
        r.code === "top10_concentration_rising" &&
        /increased by 30\.6pp over 1h/.test(r.message),
    )
  ) {
    throw new Error("missing top10 concentration Why");
  }

  const severeExplained = explainTokenRisk({
    mint: "x",
    identity: { name: "T", symbol: "T", mint: "x", imageUrl: null, decimals: 6 },
    market: baseMarket(),
    security: baseSecurity({ topHolderPct: 34.3, top10HolderPct: 41.4 }),
    trading: baseTrading(),
    risk: severe,
    axiomScore: null,
    holderIntel: severeIntel,
    whaleActivity: null,
    token: {},
    sources: [],
    partial: false,
    updatedAt: now,
  });
  if (
    !severeExplained.riskSignals.some((r) => /declined 21\.4% over 1h/.test(r.message))
  ) {
    throw new Error("explain Why missing decline");
  }

  // 2) Stable ownership → no trend warnings; LOW
  const stableIntel = holderIntel({
    deltas: [
      growthDelta({ absolute: 3, percent: 0.3, fromCount: 997, toCount: 1000 }),
    ],
    largestTrend: "stable",
    top10Trend: "stable",
    largestDeltaPp: 0.2,
    top10DeltaPp: -0.1,
  });
  const stable = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity(),
    trading: baseTrading(),
    holderIntel: stableIntel,
  });
  if (stable.level !== "LOW") {
    throw new Error(`stable expected LOW got ${stable.level}`);
  }
  if (
    stable.reasons.some((r) =>
      [
        "holders_falling_rapidly",
        "largest_holder_share_rising",
        "top10_concentration_rising",
        "holders_falling_concentration_rising",
      ].includes(r.code),
    )
  ) {
    throw new Error("stable ownership must not invent trend warnings");
  }

  // 3) Insufficient history (2 snapshots) → no trend reasons; confidence reduced
  const thinIntel = holderIntel({
    snapshotCount: 2,
    recordedMs: 5 * 60_000,
    deltas: [
      growthDelta({
        window: "5m",
        absolute: -40,
        percent: -12,
        fromCount: 300,
        toCount: 260,
      }),
    ],
    largestTrend: "increasing",
    top10Trend: "increasing",
    largestDeltaPp: 15,
    top10DeltaPp: 18,
    preferredWindow: "5m",
  });
  const thin = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity(),
    trading: baseTrading(),
    holderIntel: thinIntel,
  });
  if (
    thin.reasons.some((r) =>
      [
        "holders_falling_rapidly",
        "largest_holder_share_rising",
        "top10_concentration_rising",
      ].includes(r.code),
    )
  ) {
    throw new Error("thin history must not emit strong trend reasons");
  }
  const thinConf = assessRiskDataConfidence({
    market: baseMarket(),
    security: baseSecurity(),
    holderIntel: thinIntel,
  });
  if (thinConf !== "MEDIUM") {
    throw new Error(`thin history confidence expected MEDIUM got ${thinConf}`);
  }

  // 4) Holder count improves → no decline warning
  const improving = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity(),
    trading: baseTrading(),
    holderIntel: holderIntel({
      deltas: [
        growthDelta({
          absolute: 120,
          percent: 12,
          fromCount: 1000,
          toCount: 1120,
        }),
      ],
    }),
  });
  if (improving.reasons.some((r) => r.code === "holders_falling_rapidly")) {
    throw new Error("improving holders must not show decline warning");
  }

  // 5) Concentration decreases → no increase warning
  const deconcentrating = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity(),
    trading: baseTrading(),
    holderIntel: holderIntel({
      deltas: [growthDelta({ absolute: 0, percent: 0 })],
      largestTrend: "decreasing",
      top10Trend: "decreasing",
      largestDeltaPp: -5.5,
      top10DeltaPp: -8.2,
    }),
  });
  if (
    deconcentrating.reasons.some((r) =>
      ["largest_holder_share_rising", "top10_concentration_rising"].includes(
        r.code,
      ),
    )
  ) {
    throw new Error("falling concentration must not warn as increasing");
  }

  // 6) Missing trend data → no fabricated zero/stable risk
  const missing = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity(),
    trading: baseTrading(),
    holderIntel: null,
  });
  if (
    missing.reasons.some((r) =>
      [
        "holders_falling_rapidly",
        "largest_holder_share_rising",
        "top10_concentration_rising",
      ].includes(r.code),
    )
  ) {
    throw new Error("missing holderIntel must not fabricate trend risk");
  }

  // 7) Mild decline alone → MEDIUM, not HIGH
  const mild = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity(),
    trading: baseTrading(),
    holderIntel: holderIntel({
      deltas: [
        growthDelta({
          absolute: -30,
          percent: -5.5,
          fromCount: 545,
          toCount: 515,
        }),
      ],
    }),
  });
  if (mild.level !== "MEDIUM") {
    throw new Error(`mild decline expected MEDIUM got ${mild.level}`);
  }
  if (!mild.reasons.some((r) => /declined 5\.5% over 1h/.test(r.message))) {
    throw new Error("mild decline Why wording mismatch");
  }

  // 8) Step 1 snapshot reasons still intact alongside trends
  const withAuth = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity({ mintAuthorityActive: true }),
    trading: baseTrading(),
    holderIntel: severeIntel,
  });
  if (!withAuth.reasons.some((r) => r.code === "mint_authority_active")) {
    throw new Error("Step 1 authority reason must remain intact");
  }
  if (!withAuth.reasons.some((r) => r.code === "holders_falling_rapidly")) {
    throw new Error("trend reason must coexist with Step 1 reasons");
  }

  // 5m-only severe combo must NOT escalate to HIGH
  const shortOnly = assessTokenRisk({
    market: baseMarket(),
    security: baseSecurity(),
    trading: baseTrading(),
    holderIntel: holderIntel({
      deltas: [
        growthDelta({
          window: "5m",
          absolute: -40,
          percent: -22,
          fromCount: 200,
          toCount: 160,
        }),
      ],
      largestTrend: "increasing",
      top10Trend: "increasing",
      largestDeltaPp: 25,
      top10DeltaPp: 28,
      preferredWindow: "5m",
    }),
  });
  if (shortOnly.level === "HIGH") {
    throw new Error("5m-only trend evidence must not escalate to HIGH");
  }

  console.log("RISK_TREND_V2_OK");
} finally {
  await server.close();
}
