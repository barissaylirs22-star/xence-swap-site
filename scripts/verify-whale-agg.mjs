/**
 * Whale Activity V1.1 — live aggregation verification (MELT / Cupsina / WIF).
 * Uses the same aggregation module as the app via tsx + path alias.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Load .env.local
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

const SWAP_PROGRAM_IDS = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",
  "JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYjhBGzpQRnv",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h",
  "CPMMoo8L3F4NbTegxRfAZVQCWhVyiYEKHycNcVqYFR8",
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy6XupWLuL2s",
]);

const STABLE_OR_SOL = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);

const LOOKBACK_MS = 6 * 60 * 60 * 1000;
const TOP_ACCOUNTS = 5;
const SIGS_PER_ACCOUNT = 8;
const MAX_TX_FETCH = 24;

function pctOfSupply(part, supply) {
  if (supply <= 0n || part <= 0n) return 0;
  return Number((part * 10_000n) / supply) / 100;
}

function accountKeyString(key) {
  if (typeof key === "string") return key;
  if (key && typeof key.pubkey === "string") return key.pubkey;
  return null;
}

function hasSwapProgram(tx) {
  const keys = tx.transaction?.message?.accountKeys ?? [];
  for (const k of keys) {
    const s = accountKeyString(k);
    if (s && SWAP_PROGRAM_IDS.has(s)) return true;
  }
  for (const ix of tx.transaction?.message?.instructions ?? []) {
    if (typeof ix.programId === "string" && SWAP_PROGRAM_IDS.has(ix.programId)) {
      return true;
    }
  }
  return false;
}

function balanceMap(rows, mint) {
  const out = new Map();
  for (const row of rows ?? []) {
    if (row.mint !== mint) continue;
    const owner = row.owner;
    const amount = row.uiTokenAmount?.amount;
    if (!owner || amount == null) continue;
    try {
      out.set(owner, BigInt(amount));
    } catch {
      // skip
    }
  }
  return out;
}

function quoteDeltaForOwner(tx, owner) {
  let delta = 0;
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const preMap = new Map();
  for (const row of pre) {
    if (!row.owner || !row.mint || !STABLE_OR_SOL.has(row.mint)) continue;
    if (row.owner !== owner) continue;
    preMap.set(row.mint, row.uiTokenAmount?.uiAmount ?? 0);
  }
  for (const row of post) {
    if (!row.owner || !row.mint || !STABLE_OR_SOL.has(row.mint)) continue;
    if (row.owner !== owner) continue;
    const before = preMap.get(row.mint) ?? 0;
    const after = row.uiTokenAmount?.uiAmount ?? 0;
    delta += after - before;
  }
  return delta;
}

async function dexMeta(mint) {
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${mint}`,
  );
  const json = await res.json();
  const pairs = (json.pairs || []).filter((p) => p.chainId === "solana");
  pairs.sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  );
  const best = pairs[0];
  return {
    symbol: best?.baseToken?.symbol ?? "?",
    name: best?.baseToken?.name ?? "?",
    priceUsd: best?.priceUsd != null ? Number(best.priceUsd) : null,
    liquidityUsd: best?.liquidity?.usd ?? null,
    marketCapUsd: best?.marketCap ?? best?.fdv ?? null,
  };
}

async function collectCandidates(mint, priceUsd, liquidityUsd, marketCapUsd, classify, isAggCandidate) {
  const [supplyRes, largestRes] = await Promise.all([
    rpc("getTokenSupply", [mint]),
    rpc("getTokenLargestAccounts", [mint]),
  ]);
  const supplyRaw = BigInt(supplyRes.value.amount);
  const decimals = supplyRes.value.decimals;
  const largest = (largestRes.value || [])
    .filter((a) => a.address && BigInt(a.amount) > 0n)
    .slice(0, TOP_ACCOUNTS);

  const owners = new Map();
  for (const acct of largest) {
    try {
      const info = await rpc("getAccountInfo", [
        acct.address,
        { encoding: "jsonParsed" },
      ]);
      const owner =
        info?.value?.data?.parsed?.info?.owner ??
        info?.value?.data?.parsed?.info?.tokenAmount?.owner;
      // Token account owner field:
      const parsedOwner = info?.value?.data?.parsed?.info?.owner;
      if (typeof parsedOwner === "string") owners.set(acct.address, parsedOwner);
    } catch {
      // skip
    }
  }

  const topOwner = owners.get(largest[0]?.address) ?? null;
  const top10Owners = new Set([...owners.values()]);

  const sigMeta = [];
  const seenSig = new Set();
  for (const acct of largest) {
    const sigs = await rpc("getSignaturesForAddress", [
      acct.address,
      { limit: SIGS_PER_ACCOUNT },
    ]);
    for (const s of sigs ?? []) {
      if (!s?.signature || s.err || seenSig.has(s.signature)) continue;
      seenSig.add(s.signature);
      sigMeta.push({
        signature: s.signature,
        blockTime: s.blockTime ?? null,
      });
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const recent = sigMeta
    .filter((s) => {
      if (s.blockTime == null) return true;
      return nowSec - s.blockTime <= LOOKBACK_MS / 1000;
    })
    .slice(0, MAX_TX_FETCH);

  const candidates = [];
  const beforeAggRows = [];

  for (const item of recent) {
    const tx = await rpc("getTransaction", [
      item.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ]);
    if (!tx || tx.meta?.err) continue;
    const blockTime = tx.blockTime ?? item.blockTime;
    if (blockTime == null) continue;
    if (Date.now() - blockTime * 1000 > LOOKBACK_MS) continue;

    const pre = balanceMap(tx.meta?.preTokenBalances, mint);
    const post = balanceMap(tx.meta?.postTokenBalances, mint);
    const ownersTouched = new Set([...pre.keys(), ...post.keys()]);
    const swap = hasSwapProgram(tx);

    for (const owner of ownersTouched) {
      const before = pre.get(owner) ?? 0n;
      const after = post.get(owner) ?? 0n;
      const delta = after - before;
      if (delta === 0n) continue;
      const abs = delta < 0n ? -delta : delta;
      const supplyPct = pctOfSupply(abs, supplyRaw);
      const uiAmount = decimals >= 0 ? Number(abs) / 10 ** decimals : null;
      const usdValue =
        uiAmount != null && priceUsd != null ? uiAmount * priceUsd : null;
      const walletBalancePct =
        before > 0n
          ? Number((abs * 10_000n) / before) / 100
          : after > 0n && delta > 0n
            ? 100
            : null;
      const isTopHolder = topOwner != null && owner === topOwner;
      const isTop10 = top10Owners.has(owner);

      let kind;
      if (swap) {
        const quoteΔ = quoteDeltaForOwner(tx, owner);
        if (delta < 0n && quoteΔ >= 0) kind = "confirmed_sell";
        else if (delta > 0n && quoteΔ <= 0) kind = "confirmed_buy";
        else if (delta < 0n) kind = "confirmed_sell";
        else kind = "confirmed_buy";
      } else if (isTopHolder) {
        kind =
          delta > 0n
            ? supplyPct >= 0.5
              ? "accumulation"
              : "balance_increase"
            : supplyPct >= 0.5
              ? "distribution"
              : "top_holder_transfer";
      } else if (delta > 0n) {
        kind = supplyPct >= 1.0 ? "accumulation" : "balance_increase";
      } else {
        kind = supplyPct >= 1.0 ? "distribution" : "balance_decrease";
      }
      if (
        !swap &&
        !isTopHolder &&
        supplyPct >= 0.5 &&
        kind !== "accumulation" &&
        kind !== "distribution"
      ) {
        kind = "large_transfer";
      }

      const scored = classify({
        supplyPct,
        walletBalancePct,
        usdValue,
        isTopHolder,
        isTop10,
        liquidityUsd,
        marketCapUsd,
        isSwap: swap,
        kindHint:
          kind === "confirmed_sell"
            ? "sell"
            : kind === "confirmed_buy"
              ? "buy"
              : "other",
      });

      if (scored.significant) {
        beforeAggRows.push({
          kind,
          usdValue,
          owner,
          signature: item.signature,
          observedAt: blockTime * 1000,
          supplyPct,
        });
      }

      const { accept } = isAggCandidate({
        supplyPct,
        walletBalancePct,
        usdValue,
        isTopHolder,
        isTop10,
        liquidityUsd,
        marketCapUsd,
        isSwap: swap,
        kindHint:
          kind === "confirmed_sell"
            ? "sell"
            : kind === "confirmed_buy"
              ? "buy"
              : "other",
      });
      if (!accept) continue;

      candidates.push({
        signature: item.signature,
        observedAt: blockTime * 1000,
        kind,
        wallet: owner,
        supplyPct,
        tokenAmountUi: uiAmount,
        usdValue,
        isTopHolder,
        isTop10Holder: isTop10,
        isSwap: swap,
        walletBalancePct,
      });
    }
  }

  return { candidates, beforeAggRows, analyzedAccounts: largest.length };
}

async function main() {
  // Dynamic import of TS modules via vite-node style: use compiled path through tsx
  const { classifyWhaleSignificance, isWhaleAggregationCandidate } = await import(
    pathToFileURL(resolve(root, "src/lib/intelligence/whaleThresholds.ts")).href
  );
  const { aggregateWhaleCandidates, WHALE_AGG_WINDOW_MS } = await import(
    pathToFileURL(resolve(root, "src/lib/intelligence/whaleAggregate.ts")).href
  );

  const tokens = [
    {
      label: "MELT (MELTED REALITY)",
      mint: "H71v11cDZhr7CvtGtk3EE5v1iyeE8vCKGFH26buhpump",
    },
    {
      label: "Cupsina (quiet)",
      mint: "5nTdKXtGFcGbBHwUB7EsnEyBZ1ThGMGVofZAVpkjpump",
    },
    {
      label: "WIF (established SPL)",
      mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    },
  ];

  console.log("=== Whale Activity V1.1 aggregation verification ===");
  console.log(`Aggregation window: ${WHALE_AGG_WINDOW_MS / 60000} minutes\n`);

  for (const t of tokens) {
    console.log(`--- ${t.label} ---`);
    console.log(`mint: ${t.mint}`);
    const meta = await dexMeta(t.mint);
    console.log(
      `price=${meta.priceUsd} liq=${meta.liquidityUsd} mcap=${meta.marketCapUsd}`,
    );

    const { candidates, beforeAggRows, analyzedAccounts } =
      await collectCandidates(
        t.mint,
        meta.priceUsd,
        meta.liquidityUsd,
        meta.marketCapUsd,
        classifyWhaleSignificance,
        isWhaleAggregationCandidate,
      );

    console.log(
      `analyzedAccounts=${analyzedAccounts} candidates=${candidates.length} preAggSignificant=${beforeAggRows.length}`,
    );

    console.log("BEFORE (individually significant rows, pre-aggregation):");
    if (!beforeAggRows.length) {
      console.log("  (none)");
    } else {
      for (const r of beforeAggRows.slice(0, 12)) {
        const ageM = Math.floor((Date.now() - r.observedAt) / 60000);
        console.log(
          `  ${ageM}m · ${r.kind} · usd=${r.usdValue != null ? r.usdValue.toFixed(0) : "n/a"} · ${r.owner.slice(0, 4)}…${r.owner.slice(-4)} · ${r.signature}`,
        );
      }
    }

    const dedup = new Map();
    for (const ev of candidates) {
      const key = `${ev.signature}:${ev.wallet}:${ev.kind}`;
      const prev = dedup.get(key);
      if (!prev || ev.supplyPct > prev.supplyPct) dedup.set(key, ev);
    }

    const aggregated = aggregateWhaleCandidates([...dedup.values()], {
      liquidityUsd: meta.liquidityUsd,
      marketCapUsd: meta.marketCapUsd,
      windowMs: WHALE_AGG_WINDOW_MS,
    }).slice(0, 5);

    console.log("AFTER (aggregated, max 5):");
    if (!aggregated.length) {
      console.log("  No significant whale activity detected");
    } else {
      for (const ev of aggregated) {
        console.log(`  ${ev.line}`);
        console.log(
          `    kind=${ev.kind} aggregated=${ev.aggregated} buyCount=${ev.buyCount} sellCount=${ev.sellCount} buyUsd=${ev.buyUsd.toFixed(2)} sellUsd=${ev.sellUsd.toFixed(2)} netUsd=${ev.netUsd} transferCount=${ev.transferCount} riskRelevant=${ev.riskRelevant} major=${ev.major}`,
        );
        console.log(`    signatures (${ev.signatures.length}):`);
        for (const s of ev.signatures) {
          console.log(`      ${s}`);
          console.log(`      https://solscan.io/tx/${s}`);
        }
      }
    }

    // Wallet separation check
    const wallets = new Set(aggregated.map((e) => e.wallet));
    console.log(`distinct wallets in output: ${wallets.size}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
