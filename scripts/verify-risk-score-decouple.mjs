/**
 * Offline: Token Detail Risk level is independent of Axiom Score.
 * ZERO network. Usage: node scripts/verify-risk-score-decouple.mjs
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

function market(over = {}) {
  return {
    priceUsd: 0.01,
    marketCapUsd: 500_000,
    fdvUsd: 500_000,
    liquidityUsd: 120_000,
    priceChange5mPct: 1,
    priceChange1hPct: 2,
    priceChange24hPct: 3,
    volume24hUsd: 40_000,
    listedAt: now - 30 * 86_400_000,
    ageMs: 30 * 86_400_000,
    available: true,
    ...over,
  };
}

function security(over = {}) {
  return {
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    decimals: 6,
    supplyRaw: null,
    topHolderPct: 12,
    top10HolderPct: 40,
    holderCount: 2000,
    holdersAvailable: true,
    authoritiesAvailable: true,
    holdersStatus: "ready",
    holdersPending: false,
    holdersError: null,
    ...over,
  };
}

function trading(over = {}) {
  return {
    routeAvailable: true,
    priceImpactPct: 0.3,
    priceImpactLevel: "low",
    veryNewTokenWarning: false,
    ...over,
  };
}

function severeTrendIntel() {
  return {
    growth: {
      available: true,
      building: false,
      currentCount: 786,
      deltas: [
        {
          window: "1h",
          absolute: -214,
          percent: -21.4,
          fromAt: now - 3600_000,
          fromCount: 1000,
          toCount: 786,
          line: "",
          detailLine: "",
        },
      ],
      primaryLine: null,
      recordedMs: 3600_000,
      statusLine: null,
    },
    whale: {
      available: true,
      building: false,
      largestTrend: "increasing",
      top10Trend: "increasing",
      largestDeltaPp: 28.8,
      top10DeltaPp: 30.6,
      comparedAt: now - 3600_000,
      preferredWindow: "1h",
      windows: [],
      signals: [],
      recordedMs: 3600_000,
      statusLine: null,
    },
    interpretations: [],
    recordedMs: 3600_000,
    snapshotCount: 5,
    lastSnapshotAt: now,
  };
}

try {
  const {
    assessTokenRisk,
    computeAxiomScore,
    finalizeRiskAndScore,
    alignRiskWithAxiomScore,
    AXIOM_SCORE_WEIGHTS,
    classifyAxiomScore,
  } = await server.ssrLoadModule("/src/lib/intelligence/index.ts");

  // E) Formula weights unchanged
  if (
    AXIOM_SCORE_WEIGHTS.security !== 25 ||
    AXIOM_SCORE_WEIGHTS.holders !== 25 ||
    AXIOM_SCORE_WEIGHTS.liquidity !== 20 ||
    AXIOM_SCORE_WEIGHTS.holderTrend !== 15 ||
    AXIOM_SCORE_WEIGHTS.whale !== 15
  ) {
    throw new Error("Axiom Score weights changed unexpectedly");
  }
  const band70 = classifyAxiomScore(70);
  if (band70.band !== "healthy") {
    throw new Error("band thresholds changed unexpectedly");
  }

  // A/B) Structurally strong market + severe ownership deterioration
  // → Risk HIGH from assessTokenRisk; Score can still be relatively high.
  const severeInput = {
    market: market(),
    security: security({ topHolderPct: 34.3, top10HolderPct: 41.4 }),
    trading: trading(),
    holderIntel: severeTrendIntel(),
    whaleActivity: null,
  };
  const riskOnly = assessTokenRisk(severeInput);
  const scoreOnly = computeAxiomScore({
    ...severeInput,
    riskReasons: riskOnly.reasons,
  });
  const finalized = finalizeRiskAndScore(severeInput);

  if (riskOnly.level !== "HIGH") {
    throw new Error(`expected Risk HIGH from assessTokenRisk got ${riskOnly.level}`);
  }
  if (finalized.risk.level !== riskOnly.level) {
    throw new Error(
      `finalize risk level ${finalized.risk.level} != assessTokenRisk ${riskOnly.level}`,
    );
  }
  if (finalized.risk.level !== "HIGH") {
    throw new Error("Token Detail risk must stay HIGH from Risk V2");
  }
  // High AXM must NOT force LOW risk
  if (scoreOnly.score >= 70 && finalized.risk.level === "LOW") {
    throw new Error("high AXM Score must not force LOW risk");
  }
  if (finalized.axiomScore.score !== scoreOnly.score) {
    throw new Error("Axiom Score formula output changed via finalize");
  }
  // Reasons intact
  if (
    !finalized.risk.reasons.some((r) => r.code === "holders_falling_rapidly")
  ) {
    throw new Error("decline reason missing after finalize");
  }
  if (
    !finalized.risk.reasons.some((r) => r.code === "largest_holder_share_rising")
  ) {
    throw new Error("concentration reason missing after finalize");
  }

  // alignRiskWithAxiomScore must not overwrite level
  const aligned = alignRiskWithAxiomScore(riskOnly, {
    ...scoreOnly,
    mappedRiskLevel: "LOW",
  });
  if (aligned.level !== "HIGH") {
    throw new Error("alignRiskWithAxiomScore must not force Score mapped level");
  }

  // C) Low AXM Score does NOT automatically force HIGH risk
  // Thin liquidity + clean controls / holders → Risk MEDIUM (liq), Score low-ish
  const thinInput = {
    market: market({
      liquidityUsd: 400,
      marketCapUsd: 50_000,
      fdvUsd: 50_000,
    }),
    security: security({
      topHolderPct: 8,
      top10HolderPct: 25,
      holderCount: 5000,
    }),
    trading: trading({ priceImpactLevel: "moderate", priceImpactPct: 2 }),
    holderIntel: null,
    whaleActivity: null,
  };
  const thinRisk = assessTokenRisk(thinInput);
  const thinFinal = finalizeRiskAndScore(thinInput);
  const thinScore = thinFinal.axiomScore.score;
  if (thinFinal.risk.level !== thinRisk.level) {
    throw new Error("thin case: finalize diverged from assessTokenRisk");
  }
  if (thinScore < 50 && thinFinal.risk.level === "HIGH" && thinRisk.level !== "HIGH") {
    throw new Error("low AXM must not force HIGH when Risk V2 is not HIGH");
  }
  // Typically very_low_liquidity → MEDIUM, not HIGH (unless also very new+ultra thin)
  if (thinFinal.risk.level === "HIGH" && thinRisk.level !== "HIGH") {
    throw new Error("Score forced HIGH risk incorrectly");
  }

  // D) Clean token: Risk LOW, Score may be mid due to missing history/whale neutrals
  const cleanInput = {
    market: market(),
    security: security(),
    trading: trading(),
    holderIntel: null,
    whaleActivity: null,
  };
  const clean = finalizeRiskAndScore(cleanInput);
  const cleanRisk = assessTokenRisk(cleanInput);
  if (clean.risk.level !== cleanRisk.level) {
    throw new Error("clean: risk authority not assessTokenRisk");
  }
  if (clean.risk.level !== "LOW") {
    throw new Error(`expected clean LOW risk got ${clean.risk.level}`);
  }
  // Score can be mid-high without forcing anything
  if (clean.axiomScore.mappedRiskLevel === "HIGH" && clean.risk.level === "LOW") {
    // Legitimate independence — Score metadata can differ; Risk stays LOW
  }

  console.log(
    JSON.stringify({
      ok: true,
      severe: {
        risk: finalized.risk.level,
        axm: finalized.axiomScore.score,
        mapped: finalized.axiomScore.mappedRiskLevel,
      },
      thin: { risk: thinFinal.risk.level, axm: thinScore },
      clean: { risk: clean.risk.level, axm: clean.axiomScore.score },
    }),
  );
  console.log("RISK_SCORE_DECOUPLE_OK");
} finally {
  await server.close();
}
