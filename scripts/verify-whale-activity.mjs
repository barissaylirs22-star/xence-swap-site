/**
 * Verify Whale Activity V1 against real Helius JSON-RPC for 3 mints.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
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

const key = process.env.HELIUS_API_KEY;
if (!key) {
  console.error("HELIUS_API_KEY missing");
  process.exit(1);
}
const RPC = `https://mainnet.helius-rpc.com/?api-key=${key}`;

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

const SWAP_PROGRAMS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "CPMMoo8L3F4NbTegxRfAZVQCWhVyiYEKHycNcVqYFR8",
]);

const TOKENS = [
  {
    label: "WIF (established SPL)",
    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  },
  {
    label: "JUP (established SPL)",
    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  },
  {
    label: "BONK (high activity)",
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  },
];

function pct(part, supply) {
  if (supply <= 0n || part <= 0n) return 0;
  return Number((part * 10000n) / supply) / 100;
}

async function analyze(mint) {
  const [supplyRes, largest] = await Promise.all([
    rpc("getTokenSupply", [mint]),
    rpc("getTokenLargestAccounts", [mint]),
  ]);
  const supply = BigInt(supplyRes.value.amount);
  const accounts = (largest.value || [])
    .filter((a) => a.address && BigInt(a.amount) > 0n)
    .slice(0, 5);

  const events = [];
  for (const acct of accounts.slice(0, 3)) {
    const sigs = await rpc("getSignaturesForAddress", [
      acct.address,
      { limit: 5 },
    ]);
    for (const s of sigs || []) {
      if (s.err) continue;
      const tx = await rpc("getTransaction", [
        s.signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);
      if (!tx || tx.meta?.err) continue;
      const keys = (tx.transaction?.message?.accountKeys || []).map((k) =>
        typeof k === "string" ? k : k.pubkey,
      );
      const isSwap = keys.some((k) => SWAP_PROGRAMS.has(k));
      const pre = new Map();
      const post = new Map();
      for (const row of tx.meta?.preTokenBalances || []) {
        if (row.mint === mint && row.owner)
          pre.set(row.owner, BigInt(row.uiTokenAmount.amount));
      }
      for (const row of tx.meta?.postTokenBalances || []) {
        if (row.mint === mint && row.owner)
          post.set(row.owner, BigInt(row.uiTokenAmount.amount));
      }
      for (const owner of new Set([...pre.keys(), ...post.keys()])) {
        const before = pre.get(owner) || 0n;
        const after = post.get(owner) || 0n;
        const delta = after - before;
        if (delta === 0n) continue;
        const abs = delta < 0n ? -delta : delta;
        const supplyPct = pct(abs, supply);
        if (supplyPct < 0.05 && !isSwap) continue; // noise filter for report sample
        let kind;
        if (isSwap) kind = delta < 0n ? "confirmed_sell" : "confirmed_buy";
        else if (delta > 0n) kind = "balance_increase";
        else kind = "balance_decrease";
        events.push({
          signature: s.signature,
          blockTime: tx.blockTime,
          owner,
          supplyPct,
          kind,
          isSwap,
          explorer: `https://solscan.io/tx/${s.signature}`,
        });
      }
      if (events.length >= 3) break;
    }
    if (events.length >= 3) break;
  }
  return { supply: supplyRes.value.uiAmountString, accounts: accounts.length, events };
}

console.log("=== Whale Activity V1 live verification ===\n");
for (const t of TOKENS) {
  console.log(`--- ${t.label} ---`);
  console.log(`mint: ${t.mint}`);
  try {
    const r = await analyze(t.mint);
    console.log(`supplyUi=${r.supply} topAccounts=${r.accounts}`);
    if (!r.events.length) {
      console.log("No significant recent movements in sampled window (OK — may show none in UI)");
    }
    for (const e of r.events.slice(0, 3)) {
      console.log(
        `  ${e.kind} swap=${e.isSwap} supplyPct=${e.supplyPct.toFixed(3)}% sig=${e.signature.slice(0, 12)}… owner=${e.owner.slice(0, 4)}…${e.owner.slice(-4)} t=${e.blockTime}`,
      );
      console.log(`  evidence: ${e.explorer}`);
      if (e.kind.startsWith("confirmed_")) {
        console.log("  BUY/SELL evidence: known swap program in tx accountKeys + token balance Δ");
      } else {
        console.log("  NOT labeled BUY/SELL — transfer/balance change only");
      }
    }
  } catch (err) {
    console.error("FAIL", err.message || err);
    process.exitCode = 1;
  }
  console.log("");
}
console.log("Done.");
