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
  } = await server.ssrLoadModule("/src/lib/discovery/resolvedAxiomScore.ts");

  const mintA = "MintAAA111111111111111111111111111111111111";
  const mintB = "MintBBB222222222222222222222222222222222222";
  const tokenA = { mint: mintA, symbol: "AAA", name: "Token A", decimals: 6 };
  const tokenB = { mint: mintB, symbol: "BBB", name: "Token B", decimals: 6 };

  const before = resolveLiveAxiomScore(tokenA, {
    holderCount: 100,
    topHolderPct: 20,
    top10HolderPct: 40,
  });
  console.log("1_before", before?.mode, before?.score);

  rememberFullAxiomScore(mintA, {
    score: 86,
    band: "strong",
    label: "Strong",
    computedAt: Date.now(),
    pillars: [],
  });

  const after = resolveLiveAxiomScore(tokenA, {
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
