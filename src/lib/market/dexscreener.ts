import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";
import { getCached, invalidateCached, setCached } from "./cache";

const BASE = "https://api.dexscreener.com";
const CACHE_TTL_MS = 60_000;
const METRICS_TTL_MS = 30_000;
/** Soft cap per Dex profile endpoint before merge. */
const MAX_SECTION = 40;
/** Hard max size for AXIOM LIVE discovery universe (all Live filters). */
export const DISCOVERY_TARGET = 40;
const MINT_ENRICH_BATCH = 30;
const FRESH_MS = 72 * 60 * 60 * 1000;


interface DexProfile {
  chainId?: string;
  tokenAddress?: string;
  icon?: string;
  description?: string;
  url?: string;
}

interface DexPair {
  chainId?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | number;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  info?: { imageUrl?: string };
  pairCreatedAt?: number;
}

/** Discovery-only pair metrics — never used for swap execution. */
export type DexMarketMetrics = Pick<
  TokenAsset,
  | "priceUsd"
  | "priceChange5mPct"
  | "priceChange1hPct"
  | "priceChange24hPct"
  | "volume24hUsd"
  | "liquidityUsd"
  | "marketCapUsd"
  | "fdvUsd"
  | "listedAt"
>;

function normalizeIcon(icon?: string | null): string | null {
  if (!icon) return null;
  if (icon.startsWith("http://") || icon.startsWith("https://")) return icon;
  if (icon.startsWith("//")) return `https:${icon}`;
  return null;
}

function isPumpMint(mint: string): boolean {
  return mint.toLowerCase().endsWith("pump");
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function solanaProfiles(items: DexProfile[] | null): DexProfile[] {
  if (!items) return [];
  return items.filter(
    (item) =>
      item.chainId === "solana" &&
      typeof item.tokenAddress === "string" &&
      looksLikeMintAddress(item.tokenAddress),
  );
}

function uniqueProfiles(items: DexProfile[], limit = MAX_SECTION): DexProfile[] {
  const seen = new Set<string>();
  const out: DexProfile[] = [];
  for (const item of items) {
    const mint = item.tokenAddress!;
    if (seen.has(mint)) continue;
    seen.add(mint);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function metricsFromPair(pair: DexPair | undefined): DexMarketMetrics {
  if (!pair) {
    return {
      priceUsd: null,
      priceChange5mPct: null,
      priceChange1hPct: null,
      priceChange24hPct: null,
      volume24hUsd: null,
      liquidityUsd: null,
      marketCapUsd: null,
      fdvUsd: null,
      listedAt: null,
    };
  }

  return {
    priceUsd: asFiniteNumber(pair.priceUsd),
    priceChange5mPct: asFiniteNumber(pair.priceChange?.m5),
    priceChange1hPct: asFiniteNumber(pair.priceChange?.h1),
    priceChange24hPct: asFiniteNumber(pair.priceChange?.h24),
    volume24hUsd: asFiniteNumber(pair.volume?.h24),
    liquidityUsd: asFiniteNumber(pair.liquidity?.usd),
    marketCapUsd: asFiniteNumber(pair.marketCap),
    fdvUsd: asFiniteNumber(pair.fdv),
    listedAt: asFiniteNumber(pair.pairCreatedAt),
  };
}

/**
 * Shared latest Solana profile feed (profiles + boosts).
 * Cached so Trending/New/Pump tabs and the token selector reuse one network round-trip.
 */
async function loadLatestSolanaProfiles(
  signal?: AbortSignal,
): Promise<DexProfile[] | null> {
  const cached = getCached<DexProfile[]>("dex:latest-profiles");
  if (cached) return cached;

  const [profiles, latestBoosts] = await Promise.all([
    fetchJson<DexProfile[]>(`${BASE}/token-profiles/latest/v1`, signal),
    fetchJson<DexProfile[]>(`${BASE}/token-boosts/latest/v1`, signal),
  ]);

  const merged = solanaProfiles([...(profiles ?? []), ...(latestBoosts ?? [])]);
  if (merged.length === 0) return null;

  setCached("dex:latest-profiles", merged, CACHE_TTL_MS);
  return merged;
}

async function loadBestPairsByMint(
  mints: string[],
  signal?: AbortSignal,
): Promise<Map<string, DexPair>> {
  const bestByMint = new Map<string, DexPair>();
  if (mints.length === 0) return bestByMint;

  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `${BASE}/latest/dex/tokens/${mints.join(",")}`,
    signal,
  );

  for (const pair of data?.pairs ?? []) {
    if (pair.chainId !== "solana") continue;
    const base = pair.baseToken?.address;
    if (!base || !looksLikeMintAddress(base)) continue;
    const prev = bestByMint.get(base);
    const vol = pair.volume?.h24 ?? 0;
    const prevVol = prev?.volume?.h24 ?? 0;
    if (!prev || vol > prevVol) bestByMint.set(base, pair);
  }

  return bestByMint;
}

async function enrichWithPairs(
  seeds: Array<{ mint: string; iconUrl?: string | null; forceFresh?: boolean }>,
  signal?: AbortSignal,
  /** Fired after each mint batch with the accumulated TokenAssets so far. */
  onBatch?: (accumulated: TokenAsset[]) => void,
): Promise<TokenAsset[]> {
  if (seeds.length === 0) return [];

  const out: TokenAsset[] = [];
  const now = Date.now();

  for (let i = 0; i < seeds.length; i += MINT_ENRICH_BATCH) {
    if (signal?.aborted) break;
    const chunk = seeds.slice(i, i + MINT_ENRICH_BATCH);
    const mints = chunk.map((s) => s.mint);
    const bestByMint = await loadBestPairsByMint(mints, signal);
    const seedByMint = new Map(chunk.map((s) => [s.mint, s]));

    for (const mint of mints) {
      const seed = seedByMint.get(mint);
      const pair = bestByMint.get(mint);
      const metrics = metricsFromPair(pair);
      const symbol = pair?.baseToken?.symbol?.trim() || mint.slice(0, 4);
      const name = pair?.baseToken?.name?.trim() || "Unknown token";
      const createdAt = metrics.listedAt ?? undefined;
      const isFresh =
        seed?.forceFresh === true ||
        (typeof createdAt === "number" && now - createdAt < FRESH_MS);

      out.push({
        mint,
        symbol: symbol.slice(0, 16),
        name,
        decimals: null,
        iconUrl:
          normalizeIcon(pair?.info?.imageUrl) ||
          normalizeIcon(seed?.iconUrl) ||
          null,
        verified: false,
        selectable: true,
        warnings: ["unverified"],
        ...metrics,
        isFresh,
      });
    }

    if (out.length > 0) onBatch?.(out);
  }

  return out;
}

async function tokensFromProfiles(
  profiles: DexProfile[],
  cacheKey: string,
  options: { forceFresh?: boolean; limit?: number } = {},
  signal?: AbortSignal,
): Promise<TokenAsset[] | null> {
  const cached = getCached<TokenAsset[]>(cacheKey);
  if (cached) return cached;

  const unique = uniqueProfiles(profiles, options.limit ?? MAX_SECTION);
  if (unique.length === 0) return null;

  const tokens = await enrichWithPairs(
    unique.map((item) => ({
      mint: item.tokenAddress!,
      iconUrl: normalizeIcon(item.icon),
      forceFresh: options.forceFresh,
    })),
    signal,
  );

  if (tokens.length === 0) return null;
  setCached(cacheKey, tokens, CACHE_TTL_MS);
  return tokens;
}

/** Invalidate discovery caches so LIVE can refresh without inventing data. */
export function invalidateDexDiscoveryCaches(): void {
  invalidateCached("dex:trending");
  invalidateCached("dex:recent");
  invalidateCached("dex:new");
  invalidateCached("dex:pump");
  invalidateCached("dex:latest-profiles");
  invalidateCached("dex:discovery-universe");
  invalidateCached(`dex:discovery-universe:${DISCOVERY_TARGET}`);
  invalidateCached("dex:discovery-universe:60");
}

/**
 * Dex pair metrics for arbitrary mints (e.g. Pump.fun WS rows).
 * Missing pairs stay absent — callers must show placeholders, never invent values.
 */
export async function fetchDexMarketByMints(
  mints: string[],
  signal?: AbortSignal,
): Promise<Map<string, DexMarketMetrics>> {
  const out = new Map<string, DexMarketMetrics>();
  const unique = [
    ...new Set(
      mints.filter((m) => typeof m === "string" && looksLikeMintAddress(m)),
    ),
  ];
  if (unique.length === 0) return out;

  const pending: string[] = [];
  for (const mint of unique) {
    const cached = getCached<DexMarketMetrics>(`dex:metrics:${mint}`);
    if (cached) out.set(mint, cached);
    else pending.push(mint);
  }

  if (pending.length === 0) return out;

  for (let i = 0; i < pending.length; i += MINT_ENRICH_BATCH) {
    if (signal?.aborted) break;
    const chunk = pending.slice(i, i + MINT_ENRICH_BATCH);
    const bestByMint = await loadBestPairsByMint(chunk, signal);
    for (const mint of chunk) {
      const pair = bestByMint.get(mint);
      const metrics = metricsFromPair(pair);
      // Only cache real pair hits — empty/failed responses must not poison the TTL cache.
      if (pair) {
        setCached(`dex:metrics:${mint}`, metrics, METRICS_TTL_MS);
      }
      out.set(mint, metrics);
    }
  }

  return out;
}

/**
 * Trending Solana tokens via DexScreener boosts (discovery only — not execution).
 */
export async function fetchTrendingSolanaTokens(
  signal?: AbortSignal,
): Promise<TokenAsset[] | null> {
  const cached = getCached<TokenAsset[]>("dex:trending");
  if (cached) return cached;

  const boosts = await fetchJson<DexProfile[]>(
    `${BASE}/token-boosts/top/v1`,
    signal,
  );
  const sol = uniqueProfiles(solanaProfiles(boosts), MAX_SECTION);
  if (sol.length === 0) return null;

  const tokens = await enrichWithPairs(
    sol.map((item) => ({
      mint: item.tokenAddress!,
      iconUrl: normalizeIcon(item.icon),
    })),
    signal,
  );

  if (tokens.length === 0) return null;
  setCached("dex:trending", tokens, CACHE_TTL_MS);
  return tokens;
}

async function seedsFromSearch(
  query: string,
  signal?: AbortSignal,
): Promise<Array<{ mint: string; iconUrl?: string | null }>> {
  const data = await fetchJson<{ pairs?: DexPair[] }>(
    `${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`,
    signal,
  );
  const out: Array<{ mint: string; iconUrl?: string | null }> = [];
  const seen = new Set<string>();
  for (const pair of data?.pairs ?? []) {
    if (pair.chainId !== "solana") continue;
    const mint = pair.baseToken?.address;
    if (!mint || !looksLikeMintAddress(mint) || seen.has(mint)) continue;
    seen.add(mint);
    out.push({
      mint,
      iconUrl: normalizeIcon(pair.info?.imageUrl),
    });
  }
  return out;
}

/**
 * Broad Solana discovery universe for AXIOM LIVE (hard-capped).
 * Merges DexScreener boosts, latest profiles, and search pairs — no invented tokens.
 *
 * Seed order preserves discovery priority (boosts → fresh profiles → search).
 * Cap applies AFTER that merge and BEFORE mint-pair enrich so enrichment /
 * Risk Lite / AXM / Early never process more than `limit` tokens.
 *
 * Upstream Dex list/search endpoints are unchanged (same request set); mint-pair
 * enrich volume scales with the capped seed count.
 *
 * When `onPartial` is provided, each completed mint-enrich batch emits the
 * accumulated universe so LIVE can paint before the final set is ready.
 * Cache is written only for the final complete result.
 */
export async function fetchDiscoveryUniverse(
  signal?: AbortSignal,
  limit = DISCOVERY_TARGET,
  onPartial?: (tokens: TokenAsset[]) => void,
): Promise<TokenAsset[] | null> {
  const hardLimit = Math.min(Math.max(1, limit), DISCOVERY_TARGET);
  const cacheKey = `dex:discovery-universe:${hardLimit}`;
  const cached = getCached<TokenAsset[]>(cacheKey);
  if (cached) {
    const bounded = cached.slice(0, hardLimit);
    onPartial?.(bounded);
    return bounded;
  }

  const [topBoosts, profiles, searchSol, searchPump, searchRay] =
    await Promise.all([
      fetchJson<DexProfile[]>(`${BASE}/token-boosts/top/v1`, signal),
      loadLatestSolanaProfiles(signal),
      seedsFromSearch("SOL", signal),
      seedsFromSearch("pump", signal),
      seedsFromSearch("raydium", signal),
    ]);

  const seeds: Array<{
    mint: string;
    iconUrl?: string | null;
    forceFresh?: boolean;
  }> = [];
  const seen = new Set<string>();

  const pushSeed = (
    mint: string,
    iconUrl?: string | null,
    forceFresh?: boolean,
  ) => {
    if (!looksLikeMintAddress(mint) || seen.has(mint)) return;
    seen.add(mint);
    seeds.push({ mint, iconUrl: iconUrl ?? null, forceFresh });
  };

  for (const item of solanaProfiles(topBoosts)) {
    pushSeed(item.tokenAddress!, normalizeIcon(item.icon));
  }
  for (const item of profiles ?? []) {
    pushSeed(item.tokenAddress!, normalizeIcon(item.icon), true);
  }
  for (const seed of [...searchSol, ...searchPump, ...searchRay]) {
    pushSeed(seed.mint, seed.iconUrl);
  }

  if (seeds.length === 0) return null;

  // Cap after discovery merge/priority order — before mint enrich.
  const capped = seeds.slice(0, hardLimit);
  const tokens = await enrichWithPairs(capped, signal, (partial) => {
    if (partial.length > 0) onPartial?.(partial.slice(0, hardLimit));
  });
  // Aborted / incomplete enrich must not poison the universe cache.
  if (signal?.aborted) return null;
  if (tokens.length === 0) return null;

  const bounded = tokens.slice(0, hardLimit);
  if (bounded.length < capped.length) {
    return bounded;
  }

  // All-null metrics usually means the pairs enrich failed — never cache that.
  const withMetrics = bounded.filter(
    (t) =>
      (t.priceUsd != null && Number.isFinite(t.priceUsd)) ||
      (t.volume24hUsd != null && Number.isFinite(t.volume24hUsd)) ||
      (t.liquidityUsd != null && Number.isFinite(t.liquidityUsd)),
  ).length;
  if (withMetrics === 0) return null;

  setCached(cacheKey, bounded, CACHE_TTL_MS);
  setCached("dex:discovery-universe", bounded, CACHE_TTL_MS);
  return bounded;
}

/**
 * Recently listed Solana tokens (non-pump preferred). Discovery only.
 */
export async function fetchRecentSolanaTokens(
  signal?: AbortSignal,
): Promise<TokenAsset[] | null> {
  const profiles = await loadLatestSolanaProfiles(signal);
  if (!profiles) return null;

  const nonPump = profiles.filter((p) => !isPumpMint(p.tokenAddress!));
  const source = nonPump.length > 0 ? nonPump : profiles;
  return tokensFromProfiles(source, "dex:recent", { forceFresh: true }, signal);
}

/**
 * Pump.fun-style mints (address ends with "pump"). Discovery only.
 */
export async function fetchPumpFunTokens(
  signal?: AbortSignal,
): Promise<TokenAsset[] | null> {
  const profiles = await loadLatestSolanaProfiles(signal);
  if (!profiles) return null;

  const pump = profiles.filter((p) => isPumpMint(p.tokenAddress!));
  if (pump.length === 0) return [];
  return tokensFromProfiles(pump, "dex:pump", { forceFresh: true }, signal);
}

/**
 * Combined New / Pump.fun list for the token selector (pump-first mix).
 * Discovery only — not a swap venue.
 */
export async function fetchNewSolanaTokens(
  signal?: AbortSignal,
): Promise<TokenAsset[] | null> {
  const cached = getCached<TokenAsset[]>("dex:new");
  if (cached) return cached;

  const profiles = await loadLatestSolanaProfiles(signal);
  if (!profiles) return null;

  const pumpFirst = [
    ...profiles.filter((t) => isPumpMint(t.tokenAddress!)),
    ...profiles.filter((t) => !isPumpMint(t.tokenAddress!)),
  ];

  const tokens = await tokensFromProfiles(
    pumpFirst,
    "dex:new",
    { forceFresh: true },
    signal,
  );
  return tokens;
}
