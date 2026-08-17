import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
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

const RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}

const search = await fetch(
  "https://api.dexscreener.com/latest/dex/search?q=pump",
).then((r) => r.json());

const candidates = (search.pairs || [])
  .filter(
    (p) =>
      p.chainId === "solana" &&
      typeof p.baseToken?.address === "string" &&
      p.baseToken.address.toLowerCase().endsWith("pump"),
  )
  .slice(0, 5);

console.log("Pump candidates:", candidates.length);
for (const p of candidates) {
  const mint = p.baseToken.address;
  console.log("\n", p.baseToken.symbol, mint);
  try {
    const largest = await rpc("getTokenLargestAccounts", [mint]);
    const acct = largest.value?.[0]?.address;
    if (!acct) {
      console.log("  no largest accounts");
      continue;
    }
    const sigs = await rpc("getSignaturesForAddress", [acct, { limit: 8 }]);
    const now = Math.floor(Date.now() / 1000);
    const recent = (sigs || []).filter(
      (s) => s.blockTime && now - s.blockTime < 6 * 3600,
    );
    console.log(
      `  topAcct=${acct.slice(0, 4)}… sigs=${(sigs || []).length} within6h=${recent.length}`,
    );
    if (recent[0]) {
      console.log(`  latest ${recent[0].signature}`);
      console.log(`  https://solscan.io/tx/${recent[0].signature}`);
    }
  } catch (err) {
    console.log("  error", err.message || err);
  }
}
