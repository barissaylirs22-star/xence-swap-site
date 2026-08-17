/**
 * End-to-end Holder Intelligence V2 verification (server file store + live Helius).
 */
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createFileStore } from "../server/holderIntel/fileStore.mjs";
import { createHolderIntelHandler } from "../server/holderIntel/api.mjs";

const root = resolve(import.meta.dirname, "..");
const dataDir = resolve(root, ".data/holder-intel-verify");

function loadEnvLocal() {
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
}

loadEnvLocal();

async function rpc(method, params) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY missing in .env.local");
  const url = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

function pct(raw, supply) {
  if (!supply || supply === 0n) return null;
  return Number((raw * 10000n) / supply) / 100;
}

async function liveHolders(mint) {
  const [supplyRes, largest] = await Promise.all([
    rpc("getTokenSupply", [mint]),
    rpc("getTokenLargestAccounts", [mint]),
  ]);
  const supply = BigInt(supplyRes.value.amount);
  const amounts = (largest.value ?? []).map((a) => BigInt(a.amount));
  amounts.sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
  const top = amounts[0] ?? 0n;
  const top10 = amounts.slice(0, 10).reduce((s, n) => s + n, 0n);
  return {
    topHolderPct: pct(top, supply),
    top10HolderPct: pct(top10, supply),
    accountsSampled: amounts.length,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  console.log("=== Persistent Holder Intel verification ===\n");

  // Unit via tsx
  await new Promise((resolveP, reject) => {
    const child = spawn(
      "npx",
      ["--yes", "tsx", resolve(root, "scripts/holder-history-unit.mts")],
      { cwd: root, shell: true, stdio: "inherit" },
    );
    child.on("exit", (code) =>
      code === 0 ? resolveP() : reject(new Error(`unit exit ${code}`)),
    );
  });

  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  const store = createFileStore(dataDir);
  const { handle } = createHolderIntelHandler(store, { allowBackdate: true });

  const tokens = [
    {
      symbol: "WIF",
      mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    },
    {
      symbol: "JUP",
      mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    },
  ];

  console.log("\n--- Live concentration + server persist ---");
  const now = Date.now();

  for (const t of tokens) {
    const live = await liveHolders(t.mint);
    // Seed a prior snapshot ~1h ago with slightly different concentration/count.
    await handle({
      method: "POST",
      clientId: "verify",
      bodyText: JSON.stringify({
        mint: t.mint,
        observation: {
          t: now - 60 * 60 * 1000,
          holderCount: 1000,
          topHolderPct: (live.topHolderPct ?? 10) + 1.5,
          top10HolderPct: (live.top10HolderPct ?? 40) + 2.0,
        },
      }),
    });

    const current = await handle({
      method: "POST",
      clientId: "verify",
      bodyText: JSON.stringify({
        mint: t.mint,
        observation: {
          t: now,
          // Real concentration; synthetic count only for delta demo when census absent.
          holderCount: 1018,
          topHolderPct: live.topHolderPct,
          top10HolderPct: live.top10HolderPct,
        },
      }),
    });

    assert(current.status === 200, `${t.symbol} post ok`);
    assert(current.body.persisted === true, `${t.symbol} persisted`);
    assert(current.body.snapshotCount === 2, `${t.symbol} 2 snaps`);
    assert(current.body.intel.growth.available, `${t.symbol} growth`);
    assert(current.body.intel.whale.available, `${t.symbol} whale`);

    console.log(
      `${t.symbol}: largest=${live.topHolderPct?.toFixed(2)}% top10=${live.top10HolderPct?.toFixed(2)}%`,
    );
    console.log(`  growth: ${current.body.intel.growth.primaryLine}`);
    console.log(`  whale:  ${current.body.intel.whale.signals.join(" | ")}`);
    console.log(`  snaps:  ${JSON.stringify(await store.getSeries(t.mint))}`);
  }

  // Confirm not localStorage — clearing would be browser-only; disk still has data.
  const reopen = createFileStore(dataDir);
  for (const t of tokens) {
    const series = await reopen.getSeries(t.mint);
    assert(series.length === 2, `${t.symbol} survives reopen`);
  }
  console.log("\nPASS history survives store reopen (simulates new browser / cleared localStorage)");

  // Duplicate open inside interval
  const wif = tokens[0];
  const again = await handle({
    method: "POST",
    clientId: "verify",
    bodyText: JSON.stringify({
      mint: wif.mint,
      observation: {
        holderCount: 1019,
        topHolderPct: 13,
        top10HolderPct: 44,
      },
    }),
  });
  assert(again.body.persisted === false, "no duplicate within 5m");
  assert(again.body.snapshotCount === 2, "still 2 after duplicate open");
  console.log("PASS duplicate Token Detail open within interval does not insert");

  console.log("\nOK — persistent holder intel verification complete");
  console.log(`Store path: ${dataDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
