/**
 * Offline checks for Risk Analysis V2 Step 1 (explain / confidence).
 * ZERO network. Usage: node scripts/verify-risk-explain-v2.mjs
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

function baseIntel(over = {}) {
  return {
    mint: "Test111111111111111111111111111111111111111",
    identity: {
      name: "Test",
      symbol: "TEST",
      mint: "Test111111111111111111111111111111111111111",
      imageUrl: null,
      decimals: 6,
    },
    market: {
      priceUsd: 0.01,
      marketCapUsd: 100_000,
      fdvUsd: 100_000,
      liquidityUsd: 50_000,
      priceChange5mPct: 1,
      priceChange1hPct: 2,
      priceChange24hPct: 3,
      volume24hUsd: 20_000,
      listedAt: Date.now() - 21 * 3600_000,
      ageMs: 21 * 3600_000,
      available: true,
    },
    security: {
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      decimals: 6,
      supplyRaw: null,
      topHolderPct: null,
      top10HolderPct: null,
      holderCount: null,
      holdersAvailable: false,
      authoritiesAvailable: true,
      holdersStatus: "unavailable",
      holdersPending: false,
      holdersError: null,
    },
    trading: {
      routeAvailable: true,
      priceImpactPct: 0.4,
      priceImpactLevel: "low",
      veryNewTokenWarning: false,
    },
    risk: {
      level: "MEDIUM",
      reasons: [{ code: "very_new_token", message: "Very new token" }],
      assessedAt: Date.now(),
    },
    axiomScore: null,
    holderIntel: null,
    whaleActivity: null,
    token: {},
    sources: [],
    partial: false,
    updatedAt: Date.now(),
    ...over,
  };
}

try {
  const {
    assessRiskDataConfidence,
    buildPositiveSignals,
    explainTokenRisk,
    formatRiskSignalMessage,
  } = await server.ssrLoadModule("/src/lib/intelligence/explain.ts");

  // 1) Unknown authority → must NOT say revoked
  const unknownAuth = buildPositiveSignals({
    market: baseIntel().market,
    security: {
      ...baseIntel().security,
      authoritiesAvailable: false,
      mintAuthorityActive: null,
      freezeAuthorityActive: null,
    },
    trading: baseIntel().trading,
  });
  if (
    unknownAuth.some(
      (p) =>
        p.code === "mint_authority_revoked" ||
        p.code === "freeze_authority_revoked",
    )
  ) {
    throw new Error("unknown authority presented as revoked");
  }

  // 2) Known revoked → positives OK
  const revoked = buildPositiveSignals({
    market: baseIntel().market,
    security: baseIntel().security,
    trading: baseIntel().trading,
  });
  if (!revoked.some((p) => p.code === "mint_authority_revoked")) {
    throw new Error("expected mint revoked positive");
  }

  // 3) Confidence rules
  const high = assessRiskDataConfidence({
    market: { ...baseIntel().market, available: true },
    security: {
      ...baseIntel().security,
      authoritiesAvailable: true,
      holdersAvailable: true,
    },
  });
  const med = assessRiskDataConfidence({
    market: { ...baseIntel().market, available: true },
    security: {
      ...baseIntel().security,
      authoritiesAvailable: true,
      holdersAvailable: false,
    },
  });
  const low = assessRiskDataConfidence({
    market: { ...baseIntel().market, available: false },
    security: {
      ...baseIntel().security,
      authoritiesAvailable: false,
      holdersAvailable: false,
    },
  });
  if (high !== "HIGH" || med !== "MEDIUM" || low !== "LOW") {
    throw new Error(`confidence mismatch ${high}/${med}/${low}`);
  }

  // 4) HIGH concentration Why wording
  const highIntel = baseIntel({
    security: {
      ...baseIntel().security,
      holdersAvailable: true,
      holdersStatus: "ready",
      topHolderPct: 76.1,
      top10HolderPct: 92,
    },
    risk: {
      level: "HIGH",
      reasons: [
        { code: "high_holder_concentration", message: "High holder concentration" },
        { code: "high_top10_concentration", message: "High top-10 holder concentration" },
        { code: "insufficient_data", message: "Insufficient data" },
      ],
      assessedAt: Date.now(),
    },
  });
  const explained = explainTokenRisk(highIntel);
  if (explained.level !== "HIGH") throw new Error("expected HIGH");
  if (!explained.riskSignals.some((r) => /76\.1%/.test(r.message))) {
    throw new Error("expected largest-holder Why text");
  }
  if (!explained.riskSignals.some((r) => /92\.0%/.test(r.message))) {
    throw new Error("expected top10 Why text");
  }
  if (explained.riskSignals.some((r) => r.code === "insufficient_data")) {
    throw new Error("meta code leaked into Why");
  }
  if (explained.dataConfidence !== "HIGH") {
    throw new Error(`expected HIGH confidence got ${explained.dataConfidence}`);
  }
  if (!explained.positiveSignals.some((p) => p.code === "mint_authority_revoked")) {
    throw new Error("HIGH token should still show revoked positives");
  }

  // 5) Age formatting
  const ageMsg = formatRiskSignalMessage(
    { code: "very_new_token", message: "Very new token" },
    highIntel,
  );
  if (!/only 21h old/.test(ageMsg)) {
    throw new Error(`unexpected age message: ${ageMsg}`);
  }

  // 6) Incomplete holders → MEDIUM confidence; no fake holder positives
  const incomplete = explainTokenRisk(
    baseIntel({
      security: {
        ...baseIntel().security,
        holdersAvailable: false,
        holdersStatus: "unavailable",
        topHolderPct: null,
      },
      risk: {
        level: "UNKNOWN",
        reasons: [
          { code: "holders_data_unavailable", message: "Holder concentration unavailable" },
        ],
        assessedAt: Date.now(),
      },
    }),
  );
  if (incomplete.dataConfidence !== "MEDIUM") {
    throw new Error(`expected MEDIUM confidence got ${incomplete.dataConfidence}`);
  }
  if (incomplete.riskSignals.length !== 0) {
    throw new Error("holders_data_unavailable should not appear in Why");
  }
  if (
    incomplete.positiveSignals.some(
      (p) => p.code === "low_largest_holder" || p.code === "low_top10_holders",
    )
  ) {
    throw new Error("missing holders presented as healthy distribution");
  }

  // 7) MEDIUM risk (age) — level preserved; Why from real reason; positives OK
  const mediumExplained = explainTokenRisk(
    baseIntel({
      security: {
        ...baseIntel().security,
        holdersAvailable: true,
        holdersStatus: "ready",
        topHolderPct: 12,
        top10HolderPct: 40,
      },
      risk: {
        level: "MEDIUM",
        reasons: [{ code: "very_new_token", message: "Very new token" }],
        assessedAt: Date.now(),
      },
    }),
  );
  if (mediumExplained.level !== "MEDIUM") {
    throw new Error("MEDIUM severity must not change in presentation");
  }
  if (!mediumExplained.riskSignals.some((r) => /only 21h old/.test(r.message))) {
    throw new Error("expected MEDIUM Why age evidence");
  }
  if (!mediumExplained.positiveSignals.some((p) => p.code === "mint_authority_revoked")) {
    throw new Error("expected MEDIUM positives from known revoked authorities");
  }

  // 8) LOW risk — level preserved; no invented Why; positives from real evidence
  const lowExplained = explainTokenRisk(
    baseIntel({
      market: {
        ...baseIntel().market,
        ageMs: 30 * 86_400_000,
        listedAt: Date.now() - 30 * 86_400_000,
      },
      security: {
        ...baseIntel().security,
        holdersAvailable: true,
        holdersStatus: "ready",
        topHolderPct: 8,
        top10HolderPct: 35,
      },
      risk: {
        level: "LOW",
        reasons: [],
        assessedAt: Date.now(),
      },
    }),
  );
  if (lowExplained.level !== "LOW") {
    throw new Error("LOW severity must not change in presentation");
  }
  if (lowExplained.riskSignals.length !== 0) {
    throw new Error("LOW must not invent Why reasons");
  }
  if (!lowExplained.positiveSignals.some((p) => p.code === "mint_authority_revoked")) {
    throw new Error("expected LOW positives from known evidence");
  }
  if (lowExplained.dataConfidence !== "HIGH") {
    throw new Error(`expected HIGH confidence for complete LOW data got ${lowExplained.dataConfidence}`);
  }

  console.log("RISK_EXPLAIN_V2_OK");
} finally {
  await server.close();
}
