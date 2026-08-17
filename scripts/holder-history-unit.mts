/**
 * Server-side Holder Intelligence unit checks (file store — no localStorage).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "../server/holderIntel/fileStore.mjs";
import { createHolderIntelHandler } from "../server/holderIntel/api.mjs";
import {
  SNAPSHOT_MIN_INTERVAL_MS,
  WINDOW_TOLERANCE,
  HOLDER_GROWTH_WINDOWS,
  computeHolderGrowth,
  computeWhaleMovement,
  buildInterpretations,
} from "../server/holderIntel/core.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

const dir = await mkdtemp(join(tmpdir(), "axiom-hi-"));
const store = createFileStore(dir);
const { handle } = createHolderIntelHandler(store, { allowBackdate: true });

const MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const now = Date.now();

async function post(observation) {
  const result = await handle({
    method: "POST",
    bodyText: JSON.stringify({ mint: MINT, observation }),
    clientId: "test",
  });
  assert(result.status === 200, `status ${result.status}`);
  return result.body;
}

// 1) First observation → building
const first = await post({
  t: now - 60 * 60 * 1000,
  holderCount: 638,
  topHolderPct: 14.0,
  top10HolderPct: 51.6,
  priceUsd: 1.2,
  liquidityUsd: 50000,
  marketCapUsd: 1000000,
});
assert(first.persisted === true, "first write persisted");
assert(first.intel.growth.available === false, "first growth unavailable");
assert(first.intel.growth.building === true, "first growth building");
assert(first.intel.whale.building === true, "first whale building");
console.log("PASS first server observation → Building history");

// 2) Duplicate inside interval → no new row
const dup = await post({
  t: now - 60 * 60 * 1000 + 30_000,
  holderCount: 639,
  topHolderPct: 14.1,
  top10HolderPct: 51.7,
});
assert(dup.persisted === false, "duplicate within interval not persisted");
assert(dup.snapshotCount === 1, "still one snapshot");
console.log("PASS interval dedupe (no duplicate row)");

// 3) Later observation outside interval — 1h window
const second = await post({
  t: now,
  holderCount: 656,
  topHolderPct: 12.5,
  top10HolderPct: 48.2,
  priceUsd: 1.25,
  liquidityUsd: 52000,
  marketCapUsd: 1050000,
});
assert(second.persisted === true, "second write persisted");
assert(second.snapshotCount === 2, "two snapshots");
assert(second.intel.growth.available === true, "growth available");
assert(
  second.intel.growth.primaryLine.includes("656 holders"),
  "primary line count",
);
assert(
  second.intel.growth.primaryLine.includes("+18 in 1h"),
  `expected +18 in 1h got ${second.intel.growth.primaryLine}`,
);
const d1h = second.intel.growth.deltas.find((d) => d.window === "1h");
assert(d1h && d1h.absolute === 18, "1h absolute +18");
assert(d1h && Math.abs(d1h.percent - (18 / 638) * 100) < 0.01, "1h percent");
assert(second.intel.whale.available === true, "whale available");
assert(
  second.intel.whale.largestDeltaPp != null &&
    Math.abs(second.intel.whale.largestDeltaPp - (12.5 - 14.0)) < 0.01,
  "largest pp delta",
);
assert(
  second.intel.whale.windows.some((w) => w.window === "1h"),
  "1h concentration window",
);
assert(
  Array.isArray(second.intel.interpretations),
  "interpretations present",
);
console.log("PASS growth:", second.intel.growth.primaryLine);
console.log("PASS whale:", second.intel.whale.signals.join(" | "));
console.log("PASS interpretations:", second.intel.interpretations.join(" · "));

// 4) Survive "browser clear" — re-open store from same files
const store2 = createFileStore(dir);
const series = await store2.getSeries(MINT);
assert(series.length === 2, "history survives new store handle");
assert(series[0].priceUsd === 1.2, "market fields persisted");
const growth = computeHolderGrowth(series.slice(0, -1), series[series.length - 1]);
assert(growth.available, "recomputed growth from disk");
const whale = computeWhaleMovement(series.slice(0, -1), series[series.length - 1]);
assert(whale.available, "recomputed whale from disk");
const inter = buildInterpretations(growth, whale);
assert(inter.length >= 1, "interpretations from disk series");
console.log("PASS disk persistence across store reopen");

// 5) Tolerance: observation too far from 1h target must not invent 1h
const farPrior = {
  t: now - 12 * 60 * 1000,
  holderCount: 640,
  topHolderPct: 13,
  top10HolderPct: 50,
};
const current = {
  t: now,
  holderCount: 650,
  topHolderPct: 12,
  top10HolderPct: 49,
};
const tight = computeHolderGrowth([farPrior], current);
assert(
  !tight.deltas.some((d) => d.window === "1h"),
  "12m-old obs must not satisfy 1h window",
);
assert(
  tight.deltas.some((d) => d.window === "5m") || tight.building,
  "5m may or may not qualify depending on tolerance",
);
console.log("PASS window tolerance (no fake 1h from 12m obs)");

// 6) 6h window math when data exists
const sixH = computeHolderGrowth(
  [
    {
      t: now - 6 * 60 * 60 * 1000,
      holderCount: 500,
      topHolderPct: 20,
      top10HolderPct: 60,
    },
  ],
  {
    t: now,
    holderCount: 656,
    topHolderPct: 12.5,
    top10HolderPct: 48.2,
  },
);
const d6 = sixH.deltas.find((d) => d.window === "6h");
assert(d6 && d6.absolute === 156, "6h absolute");
assert(HOLDER_GROWTH_WINDOWS.h6 === 6 * 60 * 60 * 1000, "6h constant");
assert(WINDOW_TOLERANCE.h1 === 15 * 60 * 1000, "1h tolerance 15m");
console.log("PASS 6h window:", d6.detailLine);

// 7) GET history
const got = await handle({
  method: "GET",
  mintQuery: MINT,
  bodyText: "",
  clientId: "test",
});
assert(got.status === 200, "GET ok");
assert(got.body.snapshots.length === 2, "GET snapshots");
console.log("PASS GET / history");

// 8) Invalid mint rejected
const bad = await handle({
  method: "POST",
  bodyText: JSON.stringify({
    mint: "not-a-mint",
    observation: { holderCount: 1, topHolderPct: 1, top10HolderPct: 1 },
  }),
  clientId: "test",
});
assert(bad.status === 400, "invalid mint rejected");
console.log("PASS invalid mint rejected");

assert(SNAPSHOT_MIN_INTERVAL_MS === 5 * 60 * 1000, "5m interval");

await rm(dir, { recursive: true, force: true });
console.log("\nAll server holder-intel unit checks passed.");
