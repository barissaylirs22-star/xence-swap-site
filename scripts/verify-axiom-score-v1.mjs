/**
 * Offline AXM Score V1 finalization + hardening checks.
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
    AXM_SCORE_CAP,
    classifyAxiomScore,
    computeAxiomScore,
    finalizeRiskAndScore,
    assessTokenRisk,
  } = await server.ssrLoadModule("/src/lib/intelligence/index.ts");
  const {
    computeLightweightAxiomScore,
    clearLightweightAxiomScoreCache,
    LIGHTWEIGHT_NO_HOLDERS_SCORE_CAP,
  } = await server.ssrLoadModule("/src/lib/discovery/lightweightScore.ts");
  const {
    resolveLiveAxiomScore,
    isFullAxiomScorePublishable,
    rememberFullAxiomScore,
    peekFullAxiomScore,
  } = await server.ssrLoadModule("/src/lib/discovery/resolvedAxiomScore.ts");

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

  const now = Date.now();

  function market(over = {}) {
    return {
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
      ...over,
    };
  }

  function security(over = {}) {
    return {
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      mintAuthority: null,
      freezeAuthority: null,
      decimals: 6,
      supplyUi: null,
      topHolderPct: 8,
      top10HolderPct: 28,
      holderCount: 4000,
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
      liquidityWarning: false,
      veryNewTokenWarning: false,
      ...over,
    };
  }

  function score(over = {}) {
    return computeAxiomScore({
      market: market(over.market),
      security: security(over.security),
      trading: trading(over.trading),
      holderIntel: over.holderIntel ?? null,
      whaleActivity: over.whaleActivity ?? null,
      applySecurityCompletenessCap: over.applySecurityCompletenessCap,
    });
  }

  function hasCap(result, code) {
    return result.warnings.some((w) => w.code === code);
  }

  // ── Hardening scenarios A–K ──────────────────────────────────────────

  // A) Extreme concentration → <=29 Fragile
  const A = score({
    security: { topHolderPct: 97, top10HolderPct: 99, holderCount: 200 },
  });
  if (A.score > AXM_SCORE_CAP.extremeConcentration) {
    throw new Error(`A: expected <=29 got ${A.score}`);
  }
  if (A.band !== "extreme_risk" || A.label !== "Fragile Structure") {
    throw new Error(`A: expected Fragile Structure got ${A.band}/${A.label}`);
  }
  if (!hasCap(A, "cap_extreme_concentration")) {
    throw new Error("A: missing extreme concentration factor");
  }

  // B) High concentration → <=49 Weak
  const B = score({
    security: { topHolderPct: 55, top10HolderPct: 80, holderCount: 500 },
  });
  if (B.score > AXM_SCORE_CAP.highConcentration) {
    throw new Error(`B: expected <=49 got ${B.score}`);
  }
  if (B.band !== "high_risk" || B.label !== "Weak Structure") {
    throw new Error(`B: expected Weak Structure got ${B.band}/${B.label}`);
  }
  if (!hasCap(B, "cap_high_concentration")) {
    throw new Error("B: missing high concentration factor");
  }

  // C) Medium concentration → <=69 Caution (need uncapped >69 so cap fires)
  const C = score({
    security: { topHolderPct: 40, top10HolderPct: 60, holderCount: 800 },
    whaleActivity: {
      status: "ready",
      events: [],
      smartMoneyAvailable: false,
      analyzedAccounts: 0,
      updatedAt: now,
      errorMessage: null,
    },
    holderIntel: {
      growth: {
        available: true,
        building: false,
        currentCount: 800,
        deltas: [
          {
            window: "1h",
            absolute: 40,
            percent: 5.3,
            fromAt: now - 3600_000,
            fromCount: 760,
            toCount: 800,
            line: "",
            detailLine: "",
          },
        ],
        primaryLine: null,
        recordedMs: 3600_000,
        statusLine: null,
      },
      whale: {
        available: false,
        building: false,
        largestTrend: null,
        top10Trend: null,
        largestDeltaPp: null,
        top10DeltaPp: null,
        comparedAt: null,
        preferredWindow: null,
        windows: [],
        signals: [],
        recordedMs: null,
        statusLine: null,
      },
      interpretations: [],
      recordedMs: 3600_000,
      snapshotCount: 3,
      lastSnapshotAt: now,
    },
  });
  if (C.score > AXM_SCORE_CAP.caution) {
    throw new Error(`C: expected <=69 got ${C.score}`);
  }
  if (C.score >= 70) throw new Error("C: must not reach Healthy");
  if (C.band === "healthy" || C.band === "strong_structure") {
    throw new Error(`C: band must not be healthy/strong got ${C.band}`);
  }
  if (!hasCap(C, "cap_medium_concentration")) {
    throw new Error("C: missing medium concentration factor");
  }

  // D) Holders missing → <=69
  const D = score({
    security: {
      topHolderPct: null,
      top10HolderPct: null,
      holderCount: null,
      holdersAvailable: false,
      holdersStatus: "unavailable",
    },
  });
  if (D.score > AXM_SCORE_CAP.caution) {
    throw new Error(`D: missing holders expected <=69 got ${D.score}`);
  }
  if (!hasCap(D, "cap_holders_incomplete")) {
    throw new Error("D: missing holders-incomplete factor");
  }

  // E) Healthy structure possible — no structural cap
  const E = score({});
  if (E.score < 70) {
    throw new Error(`E: healthy fixture should reach >=70 got ${E.score}`);
  }
  if (E.band !== "healthy" && E.band !== "strong_structure") {
    throw new Error(`E: expected Healthy/Strong got ${E.band}`);
  }
  if (E.warnings.some((w) => w.code.startsWith("cap_"))) {
    throw new Error("E: must not apply structural caps");
  }

  // F) Route unavailable → <=69
  const F = score({ trading: { routeAvailable: false } });
  if (F.score > AXM_SCORE_CAP.caution) {
    throw new Error(`F: route false expected <=69 got ${F.score}`);
  }
  if (!hasCap(F, "cap_route_unavailable")) {
    throw new Error("F: missing route-unavailable factor");
  }

  // G) Very low liquidity → <=69
  const G = score({
    market: {
      liquidityUsd: 400,
      marketCapUsd: 50_000,
      fdvUsd: 50_000,
    },
    whaleActivity: {
      status: "ready",
      events: [],
      smartMoneyAvailable: false,
      analyzedAccounts: 0,
      updatedAt: now,
      errorMessage: null,
    },
  });
  if (G.score > AXM_SCORE_CAP.caution) {
    throw new Error(`G: low liq expected <=69 got ${G.score}`);
  }
  if (!hasCap(G, "cap_very_low_liquidity")) {
    throw new Error("G: missing very-low-liquidity factor");
  }

  // H) Major riskRelevant whale distribution → <=69
  const H = score({
    whaleActivity: {
      status: "ready",
      events: [
        {
          signature: "h1",
          signatures: ["h1"],
          observedAt: now,
          firstObservedAt: now,
          lastObservedAt: now,
          kind: "distribution",
          summary: "dist",
          line: "dist",
          ageLabel: "1m",
          wallet: "Wallet111",
          walletShort: "Wall…",
          supplyPct: 8,
          tokenAmountUi: 1000,
          usdValue: 50_000,
          buyUsd: 0,
          sellUsd: 50_000,
          netUsd: -50_000,
          buyCount: 0,
          sellCount: 0,
          transferCount: 1,
          aggregated: false,
          isTopHolder: true,
          isTop10Holder: true,
          isSwap: false,
          major: true,
          riskRelevant: true,
          rank: 1,
        },
        // Accumulation present must NOT cancel the danger soft cap
        {
          signature: "h2",
          signatures: ["h2"],
          observedAt: now,
          firstObservedAt: now,
          lastObservedAt: now,
          kind: "accumulation",
          summary: "accum",
          line: "accum",
          ageLabel: "2m",
          wallet: "Wallet222",
          walletShort: "Wall…",
          supplyPct: 5,
          tokenAmountUi: 500,
          usdValue: 20_000,
          buyUsd: 20_000,
          sellUsd: 0,
          netUsd: 20_000,
          buyCount: 1,
          sellCount: 0,
          transferCount: 0,
          aggregated: false,
          isTopHolder: false,
          isTop10Holder: true,
          isSwap: true,
          major: true,
          riskRelevant: true,
          rank: 2,
        },
      ],
      smartMoneyAvailable: false,
      analyzedAccounts: 10,
      updatedAt: now,
      errorMessage: null,
    },
  });
  if (H.score > AXM_SCORE_CAP.caution) {
    throw new Error(`H: whale danger expected <=69 got ${H.score}`);
  }
  if (!hasCap(H, "cap_whale_danger")) {
    throw new Error("H: missing whale-danger factor");
  }

  // I) Mint/freeze unknown → <=69
  const I = score({
    security: {
      mintAuthorityActive: null,
      freezeAuthorityActive: null,
      authoritiesAvailable: false,
    },
  });
  if (I.score > AXM_SCORE_CAP.caution) {
    throw new Error(`I: unknown security expected <=69 got ${I.score}`);
  }
  if (!hasCap(I, "cap_security_incomplete")) {
    throw new Error("I: missing security-incomplete factor");
  }

  // J) Risk Analysis behavior remains independent / unchanged by caps
  const severeInput = {
    market: market(),
    security: security({ topHolderPct: 34.3, top10HolderPct: 41.4 }),
    trading: trading(),
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
  };
  const riskOnly = assessTokenRisk(severeInput);
  const finalized = finalizeRiskAndScore(severeInput);
  if (riskOnly.level !== "HIGH") {
    throw new Error(`J: Risk must stay HIGH got ${riskOnly.level}`);
  }
  if (finalized.risk.level !== riskOnly.level) {
    throw new Error("J: finalize must not rewrite Risk level");
  }
  if (
    finalized.axiomScore.score >= 70 &&
    finalized.risk.level === "LOW"
  ) {
    throw new Error("J: Score must not force LOW risk");
  }

  // K) Pre-holder provisional score must NOT publish into full-score cache
  if (
    isFullAxiomScorePublishable({
      holdersStatus: "pending",
      holdersPending: true,
    })
  ) {
    throw new Error("K: pending holders must not be publishable");
  }
  if (
    isFullAxiomScorePublishable({
      holdersStatus: "idle",
      holdersPending: false,
    })
  ) {
    throw new Error("K: idle pre-holder must not be publishable");
  }
  if (
    !isFullAxiomScorePublishable({
      holdersStatus: "ready",
      holdersPending: false,
    })
  ) {
    throw new Error("K: ready holders must be publishable");
  }
  if (
    !isFullAxiomScorePublishable({
      holdersStatus: "unavailable",
      holdersPending: false,
    })
  ) {
    throw new Error("K: unavailable holders must be publishable");
  }
  if (
    !isFullAxiomScorePublishable({
      holdersStatus: "error",
      holdersPending: false,
    })
  ) {
    throw new Error("K: error holders must be publishable");
  }

  const mintK = "MintKKK111111111111111111111111111111111111";
  const tokenK = {
    mint: mintK,
    symbol: "KKK",
    name: "Token K",
    decimals: 6,
    selectable: true,
    liquidityUsd: 150_000,
    marketCapUsd: 800_000,
    fdvUsd: 800_000,
    volume24hUsd: 50_000,
    listedAt: now - 10 * 86_400_000,
  };
  clearLightweightAxiomScoreCache();
  const liteBefore = resolveLiveAxiomScore(tokenK, {
    status: "loading",
    holderCount: null,
    topHolderPct: null,
    top10HolderPct: null,
  });
  if (!liteBefore || liteBefore.mode !== "lightweight") {
    throw new Error("K: expected lightweight before full publish");
  }
  // Simulating gated remember: provisional pending score is NOT remembered
  if (
    isFullAxiomScorePublishable({
      holdersStatus: "pending",
      holdersPending: true,
    })
  ) {
    rememberFullAxiomScore(mintK, E);
  }
  if (peekFullAxiomScore(mintK)) {
    throw new Error("K: provisional full score leaked into cache");
  }
  // After settle, publish is allowed
  rememberFullAxiomScore(mintK, E);
  const after = resolveLiveAxiomScore(tokenK, {
    status: "ready",
    holderCount: 4000,
    topHolderPct: 8,
    top10HolderPct: 28,
  });
  if (after?.mode !== "full" || after.score !== E.score) {
    throw new Error("K: settled full score should resolve from cache");
  }

  // Existing lite no-holders + concentration consistency
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
  if (withHolders.score < 70) {
    throw new Error(
      `lite with healthy holders should exceed 69 got ${withHolders.score}`,
    );
  }

  // Lite extreme concentration uses same global caps
  clearLightweightAxiomScoreCache();
  const extremeLite = computeLightweightAxiomScore(richToken, {
    status: "ready",
    holderCount: 200,
    topHolderPct: 96.9,
    top10HolderPct: 98.6,
  });
  if (!extremeLite) throw new Error("expected extreme lite score");
  if (extremeLite.score > AXM_SCORE_CAP.extremeConcentration) {
    throw new Error(`lite BUBU-like must be <=29 got ${extremeLite.score}`);
  }
  if (extremeLite.label !== "Fragile Structure") {
    throw new Error(`lite extreme label ${extremeLite.label}`);
  }

  // Lite healthy concentration (VRBULL-like) unaffected by concentration caps
  clearLightweightAxiomScoreCache();
  const vrbullLite = computeLightweightAxiomScore(richToken, {
    status: "ready",
    holderCount: 5000,
    topHolderPct: 5.3,
    top10HolderPct: 7.7,
  });
  if (!vrbullLite) throw new Error("expected vrbull lite");
  if (vrbullLite.score <= AXM_SCORE_CAP.caution) {
    // May still be mid if other lite penalties — but must not hit concentration caps
    if (
      vrbullLite.engine.warnings.some((w) =>
        [
          "cap_extreme_concentration",
          "cap_high_concentration",
          "cap_medium_concentration",
        ].includes(w.code),
      )
    ) {
      throw new Error("VRBULL-like must not trigger concentration caps");
    }
  } else if (vrbullLite.score < 50) {
    throw new Error(`VRBULL-like unexpectedly low ${vrbullLite.score}`);
  }

  // Deterministic sort inputs
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

  console.log(
    JSON.stringify({
      ok: true,
      A: A.score,
      B: B.score,
      C: C.score,
      D: D.score,
      E: E.score,
      F: F.score,
      G: G.score,
      H: H.score,
      I: I.score,
      extremeLite: extremeLite.score,
      vrbullLite: vrbullLite.score,
      withHolders: withHolders.score,
      severeRisk: finalized.risk.level,
      severeAxm: finalized.axiomScore.score,
    }),
  );
  console.log("AXIOM_SCORE_V1_OK");
} finally {
  await server.close();
}
