import { getAxmDiscoveryEntry } from "./axm";
import { getPopularTokens } from "./catalog";
import {
  fetchNewSolanaTokens,
  fetchTrendingSolanaTokens,
} from "@/lib/market/dexscreener";
import type { TokenAsset, TokenBrowseSection } from "./types";

function withBalances(
  tokens: TokenAsset[],
  balances?: Record<string, number | null>,
): TokenAsset[] {
  if (!balances) return tokens;
  return tokens.map((t) =>
    t.mint && balances[t.mint] !== undefined
      ? { ...t, balanceUi: balances[t.mint] ?? null }
      : t,
  );
}

function exclude(tokens: TokenAsset[], excludeMint?: string): TokenAsset[] {
  if (!excludeMint) return tokens;
  return tokens.filter((t) => t.mint !== excludeMint);
}

function dedupe(tokens: TokenAsset[]): TokenAsset[] {
  const seen = new Set<string>();
  const out: TokenAsset[] = [];
  for (const token of tokens) {
    const key = token.mint || `symbol:${token.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

export interface BrowseOptions {
  signal?: AbortSignal;
  balances?: Record<string, number | null>;
  excludeMint?: string;
}

/**
 * Browse sections for the token modal (empty search).
 * Discovery/market data only — never used for swap execution.
 */
export async function loadTokenBrowseSections(
  options: BrowseOptions = {},
): Promise<TokenBrowseSection[]> {
  const popular = exclude(
    withBalances(
      dedupe([...getPopularTokens(), getAxmDiscoveryEntry()]),
      options.balances,
    ),
    options.excludeMint,
  );

  const [trendingRaw, newRaw] = await Promise.all([
    fetchTrendingSolanaTokens(options.signal).catch(() => null),
    fetchNewSolanaTokens(options.signal).catch(() => null),
  ]);

  const trending = trendingRaw
    ? exclude(withBalances(trendingRaw, options.balances), options.excludeMint)
    : [];
  const newest = newRaw
    ? exclude(withBalances(newRaw, options.balances), options.excludeMint)
    : [];

  return [
    {
      id: "popular",
      title: "Popular",
      tokens: popular,
    },
    {
      id: "trending",
      title: "Trending",
      tokens: trending,
      unavailable: trendingRaw === null,
    },
    {
      id: "new",
      title: "New / Pump.fun",
      tokens: newest,
      unavailable: newRaw === null,
    },
  ];
}
