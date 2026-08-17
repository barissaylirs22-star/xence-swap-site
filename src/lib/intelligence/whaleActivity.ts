/**
 * Whale Activity V1.1 — recent large-holder activity via Helius JSON-RPC.
 * Runs only for Token Detail (never discovery list).
 * BUY/SELL only when a known swap program participates with clear token Δ.
 * Same-wallet events are aggregated inside a rolling time window, then
 * re-scored for significance on aggregated totals.
 */

import { getCached, setCached } from "@/lib/market/cache";
import { getSolanaRpcEndpoints } from "@/lib/solana/rpcEndpoints";
import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import type { WhaleActivityFacts, WhaleEventKind } from "./types";
import {
  type WhaleRawCandidate,
  WHALE_AGG_WINDOW_MS,
  aggregateWhaleCandidates,
} from "./whaleAggregate";
import {
  WHALE_SUPPLY_MAJOR_PCT,
  WHALE_SUPPLY_SIGNIFICANT_PCT,
  isWhaleAggregationCandidate,
} from "./whaleThresholds";

const HOLDERS_RPC_PROXY_PATH = "/api/solana-holders";

const CACHE_TTL_MS = 180_000;
const FAIL_TTL_MS = 45_000;
const TOP_ACCOUNTS = 5;
const SIGS_PER_ACCOUNT = 8;
const MAX_TX_FETCH = 24;
const TX_CONCURRENCY = 2;
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
const MAX_EVENTS = 5;

export {
  WHALE_SUPPLY_MAJOR_PCT,
  WHALE_SUPPLY_SIGNIFICANT_PCT,
  WHALE_USD_DUST_FLOOR,
  WHALE_USD_MAJOR,
  WHALE_USD_SIGNIFICANT,
  classifyWhaleSignificance,
  isWhaleAggregationCandidate,
  resolveTokenSizeTier,
  tierThresholds,
} from "./whaleThresholds";

export { WHALE_AGG_WINDOW_MS } from "./whaleAggregate";

/** Known Solana swap / AMM program IDs (evidence for BUY/SELL). */
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

interface JsonRpcError {
  code?: number;
  message?: string;
}

interface TokenBalanceRow {
  accountIndex?: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
    decimals?: number;
    uiAmount?: number | null;
  };
}

interface ParsedTx {
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preTokenBalances?: TokenBalanceRow[];
    postTokenBalances?: TokenBalanceRow[];
  } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
      instructions?: Array<{
        programId?: string;
        parsed?: { type?: string };
      }>;
    };
  };
}

interface LargestAccount {
  address: string;
  amountRaw: bigint;
  uiAmount: number | null;
}

function whaleCacheKey(mint: string): string {
  return `whale:activity:v3:${mint}`;
}

function endpoints(): string[] {
  const proxy =
    (import.meta.env.VITE_HOLDERS_RPC_PROXY_PATH ?? "").trim() ||
    HOLDERS_RPC_PROXY_PATH;
  const legacy = (import.meta.env.VITE_SOLANA_HOLDERS_RPC_URL ?? "").trim();
  return [...new Set([proxy, ...(legacy ? [legacy] : []), ...getSolanaRpcEndpoints()])];
}

async function postJsonRpc<T>(
  endpoint: string,
  method: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "whale",
      method,
      params,
    }),
    signal,
  });
  const payload = (await response.json()) as {
    result?: T;
    error?: JsonRpcError;
  };
  if (!response.ok && !payload.error) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (payload.error) {
    throw new Error(payload.error.message ?? "JSON-RPC error");
  }
  if (payload.result === undefined) {
    throw new Error(`Empty result from ${method}`);
  }
  return payload.result;
}

async function withFirstEndpoint<T>(
  run: (endpoint: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const errors: string[] = [];
  for (const endpoint of endpoints()) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      return await run(endpoint);
    } catch (err) {
      if (
        err instanceof DOMException &&
        err.name === "AbortError"
      ) {
        throw err;
      }
      errors.push(err instanceof Error ? err.message : "failed");
    }
  }
  throw new Error(errors.join(" | ") || "No RPC endpoint");
}

function pctOfSupply(part: bigint, supply: bigint): number {
  if (supply <= 0n || part <= 0n) return 0;
  return Number((part * 10_000n) / supply) / 100;
}

function accountKeyString(key: string | { pubkey?: string }): string | null {
  if (typeof key === "string") return key;
  if (key && typeof key.pubkey === "string") return key.pubkey;
  return null;
}

function collectProgramIds(tx: ParsedTx): Set<string> {
  const ids = new Set<string>();
  const keys = tx.transaction?.message?.accountKeys ?? [];
  for (const k of keys) {
    const s = accountKeyString(k);
    if (s) ids.add(s);
  }
  for (const ix of tx.transaction?.message?.instructions ?? []) {
    if (typeof ix.programId === "string") ids.add(ix.programId);
  }
  return ids;
}

function hasSwapProgram(tx: ParsedTx): boolean {
  for (const id of collectProgramIds(tx)) {
    if (SWAP_PROGRAM_IDS.has(id)) return true;
  }
  return false;
}

function balanceMap(
  rows: TokenBalanceRow[] | undefined,
  mint: string,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
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

function quoteDeltaForOwner(
  tx: ParsedTx,
  owner: string,
): number {
  let delta = 0;
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const preMap = new Map<string, number>();
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

function emptyFacts(
  status: WhaleActivityFacts["status"],
  message?: string,
): WhaleActivityFacts {
  return {
    status,
    events: [],
    smartMoneyAvailable: false,
    analyzedAccounts: 0,
    updatedAt: Date.now(),
    errorMessage: message ?? null,
  };
}

/**
 * Analyze recent significant activity among largest token accounts.
 */
export async function fetchWhaleActivity(
  mint: string,
  options: {
    priceUsd?: number | null;
    liquidityUsd?: number | null;
    marketCapUsd?: number | null;
    signal?: AbortSignal;
  } = {},
): Promise<WhaleActivityFacts> {
  const trimmed = mint.trim();
  if (!looksLikeMintAddress(trimmed)) {
    return emptyFacts("unavailable", "Invalid mint");
  }

  const cached = getCached<WhaleActivityFacts>(whaleCacheKey(trimmed));
  if (cached) return cached;

  const signal = options.signal;
  const priceUsd =
    options.priceUsd != null && Number.isFinite(options.priceUsd)
      ? options.priceUsd
      : null;
  const liquidityUsd =
    options.liquidityUsd != null && Number.isFinite(options.liquidityUsd)
      ? options.liquidityUsd
      : null;
  const marketCapUsd =
    options.marketCapUsd != null && Number.isFinite(options.marketCapUsd)
      ? options.marketCapUsd
      : null;

  try {
    const { supplyRaw, largest, decimals } = await withFirstEndpoint(
      async (endpoint) => {
        const [supplyRes, largestRes] = await Promise.all([
          postJsonRpc<{
            value: { amount: string; decimals: number };
          }>(endpoint, "getTokenSupply", [trimmed], signal),
          postJsonRpc<{ value: Array<{ address: string; amount: string; uiAmount?: number | null }> }>(
            endpoint,
            "getTokenLargestAccounts",
            [trimmed],
            signal,
          ),
        ]);
        const supplyRaw = BigInt(supplyRes.value.amount);
        const largest: LargestAccount[] = [];
        for (const row of largestRes.value ?? []) {
          if (!row.address) continue;
          const amountRaw = BigInt(row.amount);
          if (amountRaw <= 0n) continue;
          largest.push({
            address: row.address,
            amountRaw,
            uiAmount: row.uiAmount ?? null,
          });
        }
        largest.sort((a, b) => (a.amountRaw === b.amountRaw ? 0 : a.amountRaw > b.amountRaw ? -1 : 1));
        return {
          supplyRaw,
          largest: largest.slice(0, TOP_ACCOUNTS),
          decimals: supplyRes.value.decimals ?? 0,
        };
      },
      signal,
    );

    if (supplyRaw <= 0n || largest.length === 0) {
      const empty = emptyFacts("unavailable", "Largest accounts unavailable");
      setCached(whaleCacheKey(trimmed), empty, FAIL_TTL_MS);
      return empty;
    }

    // Resolve token-account → owner via a lightweight getAccountInfo jsonParsed batch.
    const owners = await withFirstEndpoint(async (endpoint) => {
      const map = new Map<string, string>();
      for (const acct of largest) {
        try {
          const info = await postJsonRpc<{
            value?: {
              data?: {
                parsed?: {
                  info?: { owner?: string };
                };
              };
            } | null;
          }>(
            endpoint,
            "getAccountInfo",
            [acct.address, { encoding: "jsonParsed" }],
            signal,
          );
          const owner = info.value?.data?.parsed?.info?.owner;
          if (typeof owner === "string") map.set(acct.address, owner);
        } catch {
          // keep address as fallback identity
        }
      }
      return map;
    }, signal);

    const topOwner = owners.get(largest[0]!.address) ?? null;
    const top10Owners = new Set(
      largest
        .map((a) => owners.get(a.address))
        .filter((o): o is string => typeof o === "string"),
    );

    // Collect signatures for largest token accounts.
    const sigMeta: Array<{
      signature: string;
      blockTime: number | null;
      account: string;
    }> = [];
    const seenSig = new Set<string>();

    await withFirstEndpoint(async (endpoint) => {
      for (const acct of largest) {
        if (signal?.aborted) break;
        try {
          const sigs = await postJsonRpc<
            Array<{ signature: string; blockTime?: number | null; err?: unknown }>
          >(
            endpoint,
            "getSignaturesForAddress",
            [acct.address, { limit: SIGS_PER_ACCOUNT }],
            signal,
          );
          for (const s of sigs ?? []) {
            if (!s?.signature || s.err || seenSig.has(s.signature)) continue;
            seenSig.add(s.signature);
            sigMeta.push({
              signature: s.signature,
              blockTime: s.blockTime ?? null,
              account: acct.address,
            });
          }
        } catch {
          // continue other accounts
        }
      }
      return true;
    }, signal);

    const nowSec = Math.floor(Date.now() / 1000);
    const recent = sigMeta
      .filter((s) => {
        if (s.blockTime == null) return true;
        return nowSec - s.blockTime <= LOOKBACK_MS / 1000;
      })
      .slice(0, MAX_TX_FETCH);

    const txBySig = new Map<string, ParsedTx>();
    await withFirstEndpoint(async (endpoint) => {
      for (let i = 0; i < recent.length; i += TX_CONCURRENCY) {
        if (signal?.aborted) break;
        const chunk = recent.slice(i, i + TX_CONCURRENCY);
        await Promise.all(
          chunk.map(async (item) => {
            try {
              const tx = await postJsonRpc<ParsedTx | null>(
                endpoint,
                "getTransaction",
                [
                  item.signature,
                  {
                    encoding: "jsonParsed",
                    maxSupportedTransactionVersion: 0,
                  },
                ],
                signal,
              );
              if (tx && !tx.meta?.err) txBySig.set(item.signature, tx);
            } catch {
              // skip
            }
          }),
        );
      }
      return true;
    }, signal);

    const candidates: WhaleRawCandidate[] = [];

    for (const item of recent) {
      const tx = txBySig.get(item.signature);
      if (!tx) continue;
      const blockTime = tx.blockTime ?? item.blockTime;
      if (blockTime == null) continue;
      const ageMs = Date.now() - blockTime * 1000;
      if (ageMs > LOOKBACK_MS) continue;

      const pre = balanceMap(tx.meta?.preTokenBalances, trimmed);
      const post = balanceMap(tx.meta?.postTokenBalances, trimmed);
      const ownersTouched = new Set([...pre.keys(), ...post.keys()]);

      for (const owner of ownersTouched) {
        const before = pre.get(owner) ?? 0n;
        const after = post.get(owner) ?? 0n;
        const delta = after - before;
        if (delta === 0n) continue;

        const abs = delta < 0n ? -delta : delta;
        const supplyPct = pctOfSupply(abs, supplyRaw);
        const uiAmount =
          decimals >= 0 ? Number(abs) / 10 ** decimals : null;
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
        const swap = hasSwapProgram(tx);

        let kind: WhaleEventKind;

        if (swap) {
          // Quote asset Δ for this owner helps confirm direction.
          const quoteΔ = quoteDeltaForOwner(tx, owner);
          if (delta < 0n && quoteΔ >= 0) {
            kind = "confirmed_sell";
          } else if (delta > 0n && quoteΔ <= 0) {
            kind = "confirmed_buy";
          } else if (delta < 0n) {
            kind = "confirmed_sell";
          } else {
            kind = "confirmed_buy";
          }
        } else if (isTopHolder) {
          kind =
            delta > 0n
              ? supplyPct >= WHALE_SUPPLY_SIGNIFICANT_PCT
                ? "accumulation"
                : "balance_increase"
              : supplyPct >= WHALE_SUPPLY_SIGNIFICANT_PCT
                ? "distribution"
                : "top_holder_transfer";
        } else if (delta > 0n) {
          kind =
            supplyPct >= WHALE_SUPPLY_MAJOR_PCT
              ? "accumulation"
              : "balance_increase";
        } else {
          kind =
            supplyPct >= WHALE_SUPPLY_MAJOR_PCT
              ? "distribution"
              : "balance_decrease";
        }

        // Prefer clearer large_transfer when not a swap and not top-tier.
        if (
          !swap &&
          !isTopHolder &&
          supplyPct >= WHALE_SUPPLY_SIGNIFICANT_PCT &&
          kind !== "accumulation" &&
          kind !== "distribution"
        ) {
          kind = "large_transfer";
        }

        // Candidate gate: significant + near-miss only (not ordinary micro-flow).
        // Final display significance is re-scored on aggregated totals.
        const { accept } = isWhaleAggregationCandidate({
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

    // Dedupe identical signature+wallet+kind candidates before aggregation.
    const dedup = new Map<string, WhaleRawCandidate>();
    for (const ev of candidates) {
      const key = `${ev.signature}:${ev.wallet}:${ev.kind}`;
      const prev = dedup.get(key);
      if (!prev || ev.supplyPct > prev.supplyPct) dedup.set(key, ev);
    }

    const sorted = aggregateWhaleCandidates([...dedup.values()], {
      liquidityUsd,
      marketCapUsd,
      windowMs: WHALE_AGG_WINDOW_MS,
    }).slice(0, MAX_EVENTS);

    const facts: WhaleActivityFacts = {
      status: "ready",
      events: sorted,
      smartMoneyAvailable: false,
      analyzedAccounts: largest.length,
      updatedAt: Date.now(),
      errorMessage: null,
    };
    setCached(whaleCacheKey(trimmed), facts, CACHE_TTL_MS);
    return facts;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    const fail = emptyFacts(
      "unavailable",
      err instanceof Error ? err.message : "Whale activity unavailable",
    );
    setCached(whaleCacheKey(trimmed), fail, FAIL_TTL_MS);
    return fail;
  }
}
