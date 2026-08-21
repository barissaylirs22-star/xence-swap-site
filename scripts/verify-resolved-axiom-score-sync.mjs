/**
 * Focused offline verifier: Full Score cache → Live resolve precedence.
 * ZERO network. Usage: node scripts/verify-resolved-axiom-score-sync.mjs
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
    rememberFullAxiomScore,
    resolveLiveAxiomScore,
    peekFullAxiomScore,
    isFullAxiomScorePublishable,
  } = await server.ssrLoadModule("/src/lib/discovery/resolvedAxiomScore.ts");

  const mintA = "MintAAA111111111111111111111111111111111111";
  const mintB = "MintBBB222222222222222222222222222222222222";
  const tokenA = {
    mint: mintA,
    symbol: "AAA",
    name: "Token A",
    decimals: 6,
    selectable: true,
    liquidityUsd: 100_000,
    marketCapUsd: 500_000,
  };
  const tokenB = {
    mint: mintB,
    symbol: "BBB",
    name: "Token B",
    decimals: 6,
    selectable: true,
    liquidityUsd: 80_000,
    marketCapUsd: 400_000,
  };

  const before = resolveLiveAxiomScore(tokenA, {
    status: "ready",
    holderCount: 100,
    topHolderPct: 20,
    top10HolderPct: 40,
  });
  console.log("1_before", before?.mode, before?.score);

  // Pre-holder provisional must not be treated as publishable
  if (
    isFullAxiomScorePublishable({
      holdersStatus: "pending",
      holdersPending: true,
    })
  ) {
    throw new Error("pending holders must not publish full score");
  }

  rememberFullAxiomScore(mintA, {
    score: 86,
    band: "strong_structure",
    label: "Strong Structure",
    confidence: "HIGH",
    categories: [],
    positives: [],
    warnings: [],
    mappedRiskLevel: "LOW",
    criticalOverride: false,
    criticalOverrideReason: null,
    computedAt: Date.now(),
  });

  const after = resolveLiveAxiomScore(tokenA, {
    status: "ready",
    holderCount: 100,
    topHolderPct: 20,
    top10HolderPct: 40,
  });
  console.log(
    "2_after",
    after?.mode,
    after?.score,
    peekFullAxiomScore(mintA)?.score,
  );

  const other = resolveLiveAxiomScore(tokenB, {
    status: "ready",
    holderCount: 50,
    topHolderPct: 30,
    top10HolderPct: 55,
  });
  console.log("3_other", other?.mode, other?.score);

  if (after?.mode !== "full" || after.score !== 86) {
    throw new Error("A must resolve to cached Full Score 86");
  }
  if (other?.mode === "full") {
    throw new Error("B must remain lightweight");
  }
  console.log("SYNC_VERIFIER_OK");
} finally {
  await server.close();
}
