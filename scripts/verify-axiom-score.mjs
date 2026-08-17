/**
 * Axiom Score V2 — live verification for MELT / Cupsina / WIF / high-risk sample.
 * Usage: node scripts/verify-axiom-score.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

try {
  const raw = readFileSync(resolve(root, ".env.local"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {
  // optional
}

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

function pickHighRiskFromStore() {
  const file = resolve(root, ".data/holder-intel/store.json");
  if (!existsSync(file)) return null;
  const store = JSON.parse(readFileSync(file, "utf8"));
  const bag = store.tokens || store;
  const entries = Object.entries(bag);
  let best = null;
  for (const [mint, series] of entries) {
    if (typeof series !== "object" || !series) continue;
    const snaps = Array.isArray(series.snapshots)
      ? series.snapshots
      : Array.isArray(series)
        ? series
        : [];
    const last = snaps[snaps.length - 1];
    if (!last || typeof last !== "object") continue;
    const top = last.topHolderPct;
    if (top == null || typeof top !== "number") continue;
    // Prefer non-benchmark mints for "high risk" slot
    if (
      mint === "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" ||
      mint === "H71v11cDZhr7CvtGtk3EE5v1iyeE8vCKGFH26buhpump" ||
      mint === "5nTdKXtGFcGbBHwUB7EsnEyBZ1ThGMGVofZAVpkjpump"
    ) {
      continue;
    }
    if (!best || top > best.top) {
      best = { mint, top, top10: last.top10HolderPct ?? null };
    }
  }
  return best;
}

const hi = pickHighRiskFromStore();
if (hi && hi.top >= 35) {
  TOKENS.push({
    label: `High-risk concentrated (${hi.top.toFixed(1)}% largest)`,
    mint: hi.mint,
  });
} else {
  TOKENS.push({
    label: "BONK",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  });
}

console.log("=== Axiom Score V2 verification ===\n");

const runner = resolve(root, "scripts/_axiom-score-runner.mts");
const result = spawnSync(
  "npx",
  ["--yes", "vite-node", runner],
  {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AXIOM_SCORE_VERIFY_PAYLOAD: JSON.stringify({ tokens: TOKENS }),
      AXIOM_SCORE_BASE: process.env.AXIOM_SCORE_BASE || "http://127.0.0.1:5173",
    },
    shell: true,
    timeout: 360_000,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
