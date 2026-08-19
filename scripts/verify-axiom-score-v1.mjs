/**
 * Offline AXM Score V1 finalization checks.
 * ZERO network. Usage: node scripts/verify-axiom-score-v1.mjs
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

try {
  const {
    AXIOM_SCORE_WEIGHTS,
    classifyAxiomScore,
    computeAxiomScore,
    finalizeRiskAndScore,
  } = await server.ssrLoadModule("/src/lib/intelligence/index.ts");
  const {
    computeLightweightAxiomScore,
    clearLightweightAxiomScoreCache,
    LIGHTWEIGHT_NO_HOLDERS_SCORE_CAP,
  } = await server.ssrLoadModule("/src/lib/discovery/lightweightScore.ts");
  const { resolveLiveAxiomScore } = await server.ssrLoadModule(
    "/src/lib/discovery/resolvedAxiomScore.ts",
  );

  // Weights / bands unchanged numerically
  if (
    AXIOM_SCORE_WEIGHTS.security !== 25 ||
    AXIOM_SCORE_WEIGHTS.holders !== 25 ||
    AXIOM_SCORE_WEIGHTS.liquidity !== 20 ||
    AXIOM_SCORE_WEIGHTS.holderTrend !== 15 ||
    AXIOM_SCORE_WEIGHTS.whale !== 15
  ) {
    throw new Error("weights changed");
  }
  if (classifyAxiomScore(85).band !== "strong_structure") throw new Error("85 band");
  if (classifyAxiomScore(70).band !== "healthy") throw new Error("70 band");
  if (classifyAxiomScore(50).band !== "caution") throw new Error("50 band");
  if (classifyAxiomScore(30).band !== "high_risk") throw new Error("30 band");
  if (classifyAxiomScore(29).band !== "extreme_risk") throw new Error("29 band");

  // Structural labels — not Risk Analysis wording
  if (classifyAxiomScore(70).label !== "Healthy Structure") {
    throw new Error(`unexpected 70 label: ${classifyAxiomScore(70).label}`);
  }
  if (classifyAxiomScore(40).label !== "Weak Structure") {
    throw new Error(`unexpected 40 label: ${classifyAxiomScore(40).label}`);
  }
  if (classifyAxiomScore(10).label !== "Fragile Structure") {
    throw new Error(`unexpected 10 label: ${classifyAxiomScore(10).label}`);
  }

  clearLightweightAxiomScoreCache();

  const richToken = {
    mint: "ScoreTest111111111111111111111111111111111",
    symbol: "TST",
    name: "Test",
    decimals: 6,
    selectable: true,
    liquidityUsd: 150_000,
    marketCapUsd: 800_000,
    fdvUsd: 800_000,
    volume24hUsd: 50_000,
    listedAt: Date.now() - 10 * 86_400_000,
    priceChange5mPct: 1,
    priceChange1hPct: 2,
    priceUsd: 0.01,
  };

  // Without holders enrichment → cannot claim Healthy/Strong
  const noHolders = computeLightweightAxiomScore(richToken, {
    status: "loading",
    holderCount: null,
    topHolderPct: null,
    top10HolderPct: null,
  });
  if (!noHolders) throw new Error("expected lite score");
  if (noHolders.score > LIGHTWEIGHT_NO_HOLDERS_SCORE_CAP) {
    throw new Error(
      `no-holders preview exceeded cap ${noHolders.score} > ${LIGHTWEIGHT_NO_HOLDERS_SCORE_CAP}`,
    );
  }
  if (noHolders.band === "healthy" || noHolders.band === "strong_structure") {
    throw new Error("incomplete preview must not show healthy/strong band");
  }

  // With good holders enrichment → may exceed cap
  clearLightweightAxiomScoreCache();
  const withHolders = computeLightweightAxiomScore(richToken, {
    status: "ready",
    holderCount: 4000,
    topHolderPct: 8,
    top10HolderPct: 28,
  });
  if (!withHolders?.usedHolderEnrichment) {
    throw new Error("expected holder enrichment applied");
  }

  // Extreme concentration after enrichment → score drops (deterministic)
  clearLightweightAxiomScoreCache();
  const extreme = computeLightweightAxiomScore(richToken, {
    status: "ready",
    holderCount: 200,
    topHolderPct: 76,
    top10HolderPct: 92,
  });
  if (!extreme) throw new Error("expected extreme score");
  if (extreme.score >= withHolders.score) {
    throw new Error("extreme concentration should score lower than healthy holders");
  }
  if (extreme.band === "strong_structure" || extreme.band === "healthy") {
    throw new Error("extreme concentration must not land healthy/strong");
  }

  // Deterministic sort inputs: same evidence → same score
  clearLightweightAxiomScoreCache();
  const a = resolveLiveAxiomScore(richToken, {
    status: "ready",
    holderCount: 4000,
    topHolderPct: 8,
    top10HolderPct: 28,
  });
  const b = resolveLiveAxiomScore(richToken, {
    status: "ready",
    holderCount: 4000,
    topHolderPct: 8,
    top10HolderPct: 28,
  });
  if (!a || !b || a.score !== b.score || a.band !== b.band) {
    throw new Error("resolved score not deterministic");
  }

  // Risk remains independent of Score
  const now = Date.now();
  const severe = finalizeRiskAndScore({
    market: {
      priceUsd: 0.01,
      marketCapUsd: 500_000,
      fdvUsd: 500_000,
      liquidityUsd: 120_000,
      priceChange5mPct: 0,
      priceChange1hPct: 0,
      priceChange24hPct: 0,
      volume24hUsd: 40_000,
      listedAt: now - 30 * 86_400_000,
      ageMs: 30 * 86_400_000,
      available: true,
    },
    security: {
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      decimals: 6,
      supplyRaw: null,
      topHolderPct: 34.3,
      top10HolderPct: 41.4,
      holderCount: 786,
      holdersAvailable: true,
      authoritiesAvailable: true,
      holdersStatus: "ready",
      holdersPending: false,
      holdersError: null,
    },
    trading: {
      routeAvailable: true,
      priceImpactPct: 0.3,
      priceImpactLevel: "low",
      veryNewTokenWarning: false,
    },
    holderIntel: {
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
    },
  });
  if (severe.risk.level !== "HIGH") {
    throw new Error(`Risk must stay HIGH got ${severe.risk.level}`);
  }
  if (severe.axiomScore.score >= 70 && severe.risk.level === "LOW") {
    throw new Error("Score must not force LOW risk");
  }

  // Full engine still scores extreme concentration harshly
  const fullExtreme = computeAxiomScore({
    market: {
      priceUsd: 0.01,
      marketCapUsd: 800_000,
      fdvUsd: 800_000,
      liquidityUsd: 150_000,
      priceChange5mPct: 0,
      priceChange1hPct: 0,
      priceChange24hPct: 0,
      volume24hUsd: 50_000,
      listedAt: now - 10 * 86_400_000,
      ageMs: 10 * 86_400_000,
      available: true,
    },
    security: {
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      decimals: 6,
      supplyRaw: null,
      topHolderPct: 76,
      top10HolderPct: 92,
      holderCount: 200,
      holdersAvailable: true,
      authoritiesAvailable: true,
      holdersStatus: "ready",
      holdersPending: false,
      holdersError: null,
    },
    trading: {
      routeAvailable: true,
      priceImpactPct: 0.4,
      priceImpactLevel: "low",
      veryNewTokenWarning: false,
    },
    holderIntel: null,
    whaleActivity: null,
  });
  if (fullExtreme.score >= 70) {
    throw new Error(`extreme concentration Full score too high: ${fullExtreme.score}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      noHoldersCap: noHolders.score,
      withHolders: withHolders.score,
      extremeLite: extreme.score,
      fullExtreme: fullExtreme.score,
      severeRisk: severe.risk.level,
      severeAxm: severe.axiomScore.score,
    }),
  );
  console.log("AXIOM_SCORE_V1_OK");
} finally {
  await server.close();
}
