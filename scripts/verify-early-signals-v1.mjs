/**
 * Offline Early Signals V1 checks. ZERO network.
 * Usage: node scripts/verify-early-signals-v1.mjs
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
    mint: "Early1111111111111111111111111111111111111",
    symbol: "EAR",
    name: "Early",
    decimals: 6,
    selectable: true,
    priceUsd: 0.01,
    priceChange5mPct: 0,
    priceChange1hPct: 0,
    volume24hUsd: 5_000,
    liquidityUsd: 2_000,
    marketCapUsd: 100_000,
    fdvUsd: 100_000,
    listedAt: now - 10 * 86_400_000,
    isFresh: false,
    ...over,
  };
}

function enrich(over = {}) {
  return {
    holderCount: 1000,
    topHolderPct: 12,
    top10HolderPct: 40,
    riskLevel: "MEDIUM",
    status: "ready",
    holderGrowth: null,
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

try {
  const { assessEarlySignal } = await server.ssrLoadModule(
    "/src/lib/discovery/earlySignals.ts",
  );

  // 1) no signal — quiet market
  const none = assessEarlySignal(token(), enrich({ status: "idle" }), now);
  if (none.level !== "none") throw new Error(`expected none got ${none.level}`);

  // 2) EARLY — constructive momentum + volume + liquidity (market-only)
  const early = assessEarlySignal(
    token({
      priceChange5mPct: 12,
      volume24hUsd: 40_000,
      liquidityUsd: 20_000,
      listedAt: now - 48 * 3600_000,
    }),
    enrich({ status: "loading" }),
    now,
  );
  if (early.level !== "early") {
    throw new Error(`expected early got ${early.level} ${JSON.stringify(early)}`);
  }
  if (early.enrichmentReady) throw new Error("loading must not be enrichmentReady");

  // 3) Progressive stability — loading never BUILDING/STRONG
  if (early.level === "building" || early.level === "strong") {
    throw new Error("loading enrichment must cap at EARLY");
  }

  // 4) BUILDING — 3+ confirms including structure
  const building = assessEarlySignal(
    token({
      priceChange5mPct: 10,
      volume24hUsd: 50_000,
      liquidityUsd: 25_000,
      listedAt: now - 20 * 3600_000,
      isFresh: true,
    }),
    enrich({
      status: "ready",
      riskLevel: "LOW",
      topHolderPct: 15,
      top10HolderPct: 45,
      holderGrowth: growth(),
    }),
    now,
  );
  if (building.level !== "building" && building.level !== "strong") {
    throw new Error(`expected building/strong got ${building.level}`);
  }

  // 5) STRONG — growth + healthy concentration + market cluster
  const strong = assessEarlySignal(
    token({
      priceChange5mPct: 8,
      volume24hUsd: 80_000,
      liquidityUsd: 40_000,
      listedAt: now - 12 * 3600_000,
    }),
    enrich({
      status: "ready",
      riskLevel: "LOW",
      topHolderPct: 10,
      top10HolderPct: 35,
      holderGrowth: growth({ absolute: 120, percent: 15 }),
    }),
    now,
  );
  if (strong.level !== "strong") {
    throw new Error(
      `expected strong got ${strong.level} n=${strong.confirmations.length} ${strong.confirmations.map((c) => c.id)}`,
    );
  }
  if (!strong.confirmations.some((c) => c.id === "holders_growing")) {
    throw new Error("strong must include holders_growing");
  }

  // 6) Missing holder data — not invented positive
  const missingHolders = assessEarlySignal(
    token({
      priceChange5mPct: 9,
      volume24hUsd: 30_000,
      liquidityUsd: 15_000,
    }),
    enrich({ status: "unavailable", holderGrowth: null, topHolderPct: null }),
    now,
  );
  if (missingHolders.confirmations.some((c) => c.id === "holders_growing")) {
    throw new Error("missing holders must not invent growth confirm");
  }
  if (missingHolders.level === "strong" || missingHolders.level === "building") {
    throw new Error("unavailable enrichment must not reach building/strong");
  }

  // 7) Extreme spike alone — suppressed
  const spike = assessEarlySignal(
    token({
      priceChange5mPct: 120,
      volume24hUsd: 5_000,
      liquidityUsd: 2_000,
    }),
    enrich({ status: "idle" }),
    now,
  );
  if (spike.level !== "none") {
    throw new Error(`spike alone must be none got ${spike.level}`);
  }
  if (!spike.suppressed) throw new Error("spike should be suppressed");

  // 8) High-risk suppression
  const highRisk = assessEarlySignal(
    token({
      priceChange5mPct: 10,
      volume24hUsd: 50_000,
      liquidityUsd: 30_000,
      listedAt: now - 10 * 3600_000,
    }),
    enrich({
      status: "ready",
      riskLevel: "HIGH",
      topHolderPct: 20,
      top10HolderPct: 50,
      holderGrowth: growth(),
    }),
    now,
  );
  if (highRisk.level !== "none" || !highRisk.suppressed) {
    throw new Error("HIGH risk must suppress early signal");
  }

  // 9) Extreme concentration suppression
  const extremeConc = assessEarlySignal(
    token({
      priceChange5mPct: 10,
      volume24hUsd: 50_000,
      liquidityUsd: 30_000,
    }),
    enrich({
      status: "ready",
      riskLevel: "MEDIUM",
      topHolderPct: 76,
      top10HolderPct: 92,
      holderGrowth: growth(),
    }),
    now,
  );
  if (extremeConc.level !== "none") {
    throw new Error("extreme concentration must suppress");
  }

  // 10) Single confirmation — no signal
  const single = assessEarlySignal(
    token({ liquidityUsd: 20_000, volume24hUsd: 1_000, priceChange5mPct: 0 }),
    enrich({ status: "idle" }),
    now,
  );
  if (single.level !== "none") throw new Error("single confirm must be none");

  // WHY present for real signals
  if (strong.confirmations.length < 4) {
    throw new Error("strong WHY must list multiple confirms");
  }

  console.log(
    JSON.stringify({
      ok: true,
      none: none.level,
      early: early.level,
      building: building.level,
      strong: strong.level,
      spike: spike.suppressReason,
      highRisk: highRisk.suppressReason,
    }),
  );
  console.log("EARLY_SIGNALS_V1_OK");
} finally {
  await server.close();
}
