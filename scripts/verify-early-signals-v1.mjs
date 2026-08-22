/**
 * Offline Early Signals V1 checks (discrete kinds). ZERO network.
 * Usage: node scripts/verify-early-signals-v1.mjs
 * Covers scenarios A–O from the Early Signals V1 spec.
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
    concentrationTrend: null,
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

function trend(over = {}) {
  return {
    available: true,
    largestTrend: "stable",
    top10Trend: "stable",
    largestDeltaPp: 0,
    top10DeltaPp: 0,
    preferredWindow: "1h",
    comparedAt: now - 3600_000,
    signals: [],
    ...over,
  };
}

function ids(result) {
  return result.signals.map((s) => s.id);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  const { assessEarlySignal, hasEarlySignal } = await server.ssrLoadModule(
    "/src/lib/discovery/earlySignals.ts",
  );

  // A) holders rising + concentration falling ≥2pp → structure_building
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        holderGrowth: growth(),
        concentrationTrend: trend({
          largestTrend: "decreasing",
          largestDeltaPp: -2.5,
        }),
      }),
      now,
    );
    assert(ids(r).includes("structure_building"), `A: expected structure_building got ${ids(r)}`);
    assert(!ids(r).includes("holder_momentum"), "A: holder_momentum must be folded");
    assert(!ids(r).includes("distribution_improving"), "A: distribution_improving must be folded");
    assert(r.livePrimary?.id === "structure_building", "A: Live primary structure_building");
    assert(r.maturity === "ACTIVE", "A: ACTIVE");
  }

  // B) holders rising, concentration stable → holder_momentum
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        holderGrowth: growth(),
        concentrationTrend: trend({
          largestTrend: "stable",
          top10Trend: "stable",
          largestDeltaPp: 0.2,
          top10DeltaPp: -0.1,
        }),
      }),
      now,
    );
    assert(ids(r).includes("holder_momentum"), `B: expected holder_momentum got ${ids(r)}`);
    assert(!ids(r).includes("structure_building"), "B: no structure_building");
    assert(r.livePrimary?.id === "holder_momentum", "B: primary holder_momentum");
  }

  // C) concentration falling ≥2pp, holders not falling → distribution_improving
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        holderGrowth: null,
        concentrationTrend: trend({
          top10Trend: "decreasing",
          top10DeltaPp: -3.0,
        }),
      }),
      now,
    );
    assert(
      ids(r).includes("distribution_improving"),
      `C: expected distribution_improving got ${ids(r)}`,
    );
    assert(!ids(r).includes("structure_building"), "C: no structure without growth");
  }

  // D) concentration rising ≥2pp → concentration_rising caution
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        holderGrowth: null,
        concentrationTrend: trend({
          largestTrend: "increasing",
          largestDeltaPp: 2.8,
        }),
      }),
      now,
    );
    assert(ids(r).includes("concentration_rising"), `D: expected concentration_rising got ${ids(r)}`);
    assert(r.signals.find((s) => s.id === "concentration_rising")?.tone === "caution", "D: caution");
  }

  // E) new token <72h + holder momentum + liq ≥5k → new_token_traction
  {
    const r = assessEarlySignal(
      token({
        listedAt: now - 24 * 3600_000,
        liquidityUsd: 6_000,
        volume24hUsd: 1_000,
      }),
      enrich({
        holderGrowth: growth(),
        concentrationTrend: trend(),
      }),
      now,
    );
    assert(ids(r).includes("new_token_traction"), `E: expected new_token_traction got ${ids(r)}`);
    assert(ids(r).includes("holder_momentum"), "E: also holder_momentum");
  }

  // F) new token + price spike only → NO Early Signal
  {
    const r = assessEarlySignal(
      token({
        listedAt: now - 12 * 3600_000,
        priceChange5mPct: 120,
        volume24hUsd: 50_000,
        liquidityUsd: 20_000,
      }),
      enrich({
        holderGrowth: null,
        concentrationTrend: null,
      }),
      now,
    );
    assert(!hasEarlySignal(r), `F: price spike only must not fire got ${ids(r)} maturity=${r.maturity}`);
  }

  // G) +1 holder / insignificant growth → NO holder momentum
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        holderGrowth: growth({
          absolute: 1,
          percent: 0.1,
          fromCount: 100,
          toCount: 101,
        }),
        concentrationTrend: trend(),
      }),
      now,
    );
    assert(!ids(r).includes("holder_momentum"), `G: tiny growth must not fire got ${ids(r)}`);
  }

  // H) missing holder history → BUILDING/INSUFFICIENT, not positive
  {
    const building = assessEarlySignal(
      token(),
      enrich({ holderGrowth: null, concentrationTrend: null }),
      now,
    );
    assert(
      building.maturity === "BUILDING_HISTORY" ||
        building.maturity === "INSUFFICIENT_DATA",
      `H: expected BUILDING/INSUFFICIENT got ${building.maturity}`,
    );
    assert(!building.signals.some((s) => s.tone === "positive"), "H: no positive");

    const insufficient = assessEarlySignal(token(), enrich({ status: "loading" }), now);
    assert(insufficient.maturity === "INSUFFICIENT_DATA", "H: loading → INSUFFICIENT_DATA");
    assert(!hasEarlySignal(insufficient), "H: loading not active");
  }

  // I) largest ≥50 or top10 ≥85 → positive Early Signals suppressed
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        topHolderPct: 55,
        top10HolderPct: 40,
        holderGrowth: growth(),
        concentrationTrend: trend({
          largestTrend: "decreasing",
          largestDeltaPp: -3,
        }),
      }),
      now,
    );
    assert(r.suppressed, "I: suppressed");
    assert(!r.signals.some((s) => s.tone === "positive"), `I: no positives got ${ids(r)}`);
  }

  // J) Risk HIGH → positive Early Signals suppressed
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        riskLevel: "HIGH",
        holderGrowth: growth(),
        concentrationTrend: trend({
          largestTrend: "decreasing",
          largestDeltaPp: -3,
        }),
      }),
      now,
    );
    assert(r.suppressed, "J: suppressed");
    assert(!r.signals.some((s) => s.tone === "positive"), `J: no positives got ${ids(r)}`);
  }

  // K) major/riskRelevant confirmed whale distribution in Detail → whale_distribution_alert
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        holderGrowth: null,
        concentrationTrend: trend(),
      }),
      {
        now,
        includeWhale: true,
        whaleActivity: {
          status: "ready",
          events: [
            {
              signature: "sig1",
              signatures: ["sig1"],
              observedAt: now,
              firstObservedAt: now,
              lastObservedAt: now,
              kind: "distribution",
              summary: "dist",
              line: "dist",
              ageLabel: "1h",
              wallet: "Wallet111",
              walletShort: "Wall…",
              supplyPct: 8,
              tokenAmountUi: 1000,
              usdValue: 50_000,
              buyUsd: 0,
              sellUsd: 50_000,
              netUsd: -50_000,
              buyCount: 0,
              sellCount: 2,
              transferCount: 0,
              aggregated: true,
              isTopHolder: true,
              isTop10Holder: true,
              isSwap: true,
              major: true,
              riskRelevant: true,
              rank: 1,
            },
          ],
          smartMoneyAvailable: false,
          analyzedAccounts: 5,
          updatedAt: now,
          errorMessage: null,
        },
      },
    );
    assert(
      ids(r).includes("whale_distribution_alert"),
      `K: expected whale_distribution_alert got ${ids(r)}`,
    );
  }

  // L) small/micro whale display event → NO whale_distribution_alert
  {
    const r = assessEarlySignal(
      token(),
      enrich({ concentrationTrend: trend() }),
      {
        now,
        includeWhale: true,
        whaleActivity: {
          status: "ready",
          events: [
            {
              signature: "sig2",
              signatures: ["sig2"],
              observedAt: now,
              firstObservedAt: now,
              lastObservedAt: now,
              kind: "distribution",
              summary: "micro",
              line: "micro",
              ageLabel: "1h",
              wallet: "Wallet222",
              walletShort: "Wall…",
              supplyPct: 0.1,
              tokenAmountUi: 10,
              usdValue: 50,
              buyUsd: 0,
              sellUsd: 50,
              netUsd: -50,
              buyCount: 0,
              sellCount: 1,
              transferCount: 0,
              aggregated: false,
              isTopHolder: false,
              isTop10Holder: false,
              isSwap: true,
              major: false,
              riskRelevant: false,
              rank: 9,
            },
          ],
          smartMoneyAvailable: false,
          analyzedAccounts: 5,
          updatedAt: now,
          errorMessage: null,
        },
      },
    );
    assert(
      !ids(r).includes("whale_distribution_alert"),
      `L: micro must not fire got ${ids(r)}`,
    );
  }

  // M) missing volume and liquidity → no new_token_traction
  {
    const r = assessEarlySignal(
      token({
        listedAt: now - 10 * 3600_000,
        volume24hUsd: null,
        liquidityUsd: null,
      }),
      enrich({ holderGrowth: growth(), concentrationTrend: trend() }),
      now,
    );
    assert(!ids(r).includes("new_token_traction"), `M: no traction got ${ids(r)}`);
  }

  // N) old token >72h with holder momentum → holder_momentum allowed, new_token_traction absent
  {
    const r = assessEarlySignal(
      token({
        listedAt: now - 10 * 86_400_000,
        liquidityUsd: 20_000,
        volume24hUsd: 40_000,
      }),
      enrich({ holderGrowth: growth(), concentrationTrend: trend() }),
      now,
    );
    assert(ids(r).includes("holder_momentum"), `N: holder_momentum got ${ids(r)}`);
    assert(!ids(r).includes("new_token_traction"), "N: no new_token_traction for old token");
  }

  // O) structure_building active → primary Live is structure_building, no badge flooding
  {
    const r = assessEarlySignal(
      token({
        listedAt: now - 20 * 3600_000,
        liquidityUsd: 8_000,
        volume24hUsd: 15_000,
      }),
      enrich({
        holderGrowth: growth(),
        concentrationTrend: trend({
          largestTrend: "decreasing",
          largestDeltaPp: -4,
          top10Trend: "decreasing",
          top10DeltaPp: -5,
        }),
      }),
      now,
    );
    assert(r.livePrimary?.id === "structure_building", `O: primary got ${r.livePrimary?.id}`);
    assert(!ids(r).includes("holder_momentum"), "O: no holder_momentum flood");
    assert(!ids(r).includes("distribution_improving"), "O: no distribution_improving flood");
    // new_token_traction may still be in signals list but Live primary stays structure_building
    assert(r.livePrimary.label === "Structure Building", "O: named badge");
  }

  // Significant negative growth → caution holder_momentum
  {
    const r = assessEarlySignal(
      token(),
      enrich({
        holderGrowth: growth({ absolute: -90, percent: -12, toCount: 560 }),
        concentrationTrend: trend(),
      }),
      now,
    );
    const hm = r.signals.find((s) => s.id === "holder_momentum");
    assert(hm?.tone === "caution", `neg growth caution got ${JSON.stringify(hm)}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      scenarios: "A-O",
      sample: {
        structure: "structure_building",
        maturityBuilding: "BUILDING_HISTORY",
      },
    }),
  );
  console.log("EARLY_SIGNALS_V1_OK");
} finally {
  await server.close();
}
