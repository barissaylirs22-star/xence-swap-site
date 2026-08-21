/**
 * Lightweight vs Full Axiom Score comparison (no whale list calls).
 * Usage: node scripts/verify-lightweight-score.mjs
 */
import { readFileSync } from "node:fs";
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

console.log("=== Lightweight Axiom Score verification ===\n");

const runner = resolve(root, "scripts/_lightweight-score-runner.mts");
const result = spawnSync("npx", ["--yes", "vite-node@2.1.9", runner], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    AXIOM_SCORE_BASE: process.env.AXIOM_SCORE_BASE || "http://127.0.0.1:5173",
    AXIOM_LW_VERIFY_PAYLOAD: JSON.stringify({ tokens: TOKENS }),
  },
  shell: true,
  timeout: 360_000,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
