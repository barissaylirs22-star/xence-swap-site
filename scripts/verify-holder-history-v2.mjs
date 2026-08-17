/**
 * Live Holder History V2 verification against .data/holder-intel + optional Vite API.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeHolderGrowth,
  computeWhaleMovement,
  buildInterpretations,
  applyObservation,
  WINDOW_TOLERANCE,
  SNAPSHOT_MIN_INTERVAL_MS,
  formatDuration,
} from "../server/holderIntel/core.mjs";
import { createFileStore } from "../server/holderIntel/fileStore.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const storePath = resolve(root, ".data/holder-intel");

const TOKENS = [
  {
    label: "MELT",
    mint: "H71v11cDZhr7CvtGtk3EE5v1iyeE8vCKGFH26buhpump",
  },
  {
    label: "Cupsina",
    mint: "5nTdKXtGFcGbBHwUB7EsnEyBZ1ThGMGVofZAVpkjpump",
  },
  {
    label: "WIF",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  },
];

function loadStoreJson() {
  const file = resolve(storePath, "store.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

console.log("=== Holder History & Concentration Trend V2 verification ===\n");
console.log(`Sampling interval: ${SNAPSHOT_MIN_INTERVAL_MS / 60000}m`);
console.log(
  `Tolerances: 5m±${WINDOW_TOLERANCE.m5 / 60000}m 1h±${WINDOW_TOLERANCE.h1 / 60000}m 6h±${WINDOW_TOLERANCE.h6 / 60000}m 24h±${WINDOW_TOLERANCE.h24 / 3600000}h`,
);
console.log(`Store dir: ${storePath}\n`);

const raw = loadStoreJson();
if (!raw?.mints) {
  console.log("No existing store.json — creating empty for reopen test");
} else {
  console.log(`Existing mints in store: ${Object.keys(raw.mints).length}`);
}

const store = createFileStore(storePath);

for (const t of TOKENS) {
  console.log(`--- ${t.label} ---`);
  console.log(`mint: ${t.mint}`);
  const series = await store.getSeries(t.mint);
  console.log(`snapshots: ${series.length}`);
  if (!series.length) {
    console.log("  (no history yet — will show Building history in UI)");
    console.log("");
    continue;
  }

  const first = series[0];
  const last = series[series.length - 1];
  const span = last.t - first.t;
  console.log(
    `  span=${formatDuration(span)} first=${new Date(first.t).toISOString()} last=${new Date(last.t).toISOString()}`,
  );
  console.log(
    `  latest: holders=${last.holderCount} largest=${last.topHolderPct}% top10=${last.top10HolderPct}% price=${last.priceUsd ?? "n/a"} liq=${last.liquidityUsd ?? "n/a"} mcap=${last.marketCapUsd ?? "n/a"}`,
  );

  const historical = series.slice(0, -1);
  const growth = computeHolderGrowth(historical, last);
  const whale = computeWhaleMovement(historical, last);
  const inter = buildInterpretations(growth, whale);

  console.log(
    `  growth.available=${growth.available} building=${growth.building} status=${growth.statusLine ?? "n/a"}`,
  );
  if (growth.available) {
    for (const d of growth.deltas) {
      console.log(`    ${d.detailLine}`);
    }
    console.log(`  primary: ${growth.primaryLine}`);
  }
  console.log(
    `  concentration.available=${whale.available} preferred=${whale.preferredWindow} building=${whale.building}`,
  );
  if (whale.available) {
    for (const w of whale.windows) {
      console.log(
        `    ${w.window}: largest ${w.largestDeltaPp != null ? w.largestDeltaPp.toFixed(2) + "pp" : "n/a"} top10 ${w.top10DeltaPp != null ? w.top10DeltaPp.toFixed(2) + "pp" : "n/a"}`,
      );
    }
    console.log(`  signals: ${whale.signals.join(" | ") || "(none)"}`);
  } else {
    console.log(`  status: ${whale.statusLine}`);
  }
  console.log(`  interpretations: ${inter.join(" · ") || "(none)"}`);

  // Dedupe check: apply same obs within interval
  const dup = applyObservation(series, { ...last, t: last.t + 30_000 }, Date.now());
  console.log(
    `  dedupe within 5m: wrote=${dup.wrote} (expect false)`,
  );
  console.log("");
}

// Restart survival: reopen store
const store2 = createFileStore(storePath);
for (const t of TOKENS) {
  const a = await store.getSeries(t.mint);
  const b = await store2.getSeries(t.mint);
  const ok = a.length === b.length;
  console.log(
    `reopen ${t.label}: ${ok ? "PASS" : "FAIL"} snaps=${b.length}`,
  );
}

console.log("\nDone.");
