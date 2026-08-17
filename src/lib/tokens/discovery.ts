import { getAxmDiscoveryEntry, isAxmToken } from "./axm";
import {
  DEFAULT_TOKEN_SEEDS,
  getPopularTokens,
  looksLikeMintAddress,
  SOL_TOKEN,
  USDC_TOKEN,
} from "./catalog";
import { JupiterTokenDiscovery } from "./jupiter/discovery";
import { resolveMintOnChain } from "./onchain";
import type { TokenAsset, TokenDiscoveryProvider } from "./types";

const remote: TokenDiscoveryProvider = new JupiterTokenDiscovery();

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

function matchesQuery(token: TokenAsset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    token.symbol.toLowerCase().includes(q) ||
    token.name.toLowerCase().includes(q) ||
    token.mint.toLowerCase() === q ||
    token.mint.toLowerCase().includes(q)
  );
}

function withWalletBalances(
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

function prioritizeHeld(tokens: TokenAsset[]): TokenAsset[] {
  return [...tokens].sort((a, b) => {
    const ab = a.balanceUi ?? 0;
    const bb = b.balanceUi ?? 0;
    if (ab > 0 && bb <= 0) return -1;
    if (bb > 0 && ab <= 0) return 1;
    return 0;
  });
}

export interface SearchTokensOptions {
  query: string;
  signal?: AbortSignal;
  /** mint → UI balance for prioritization */
  balances?: Record<string, number | null>;
  excludeMint?: string;
}

/**
 * Scalable token search:
 * seeds + AXM entry + remote discovery + optional on-chain mint resolve.
 */
export async function searchTokens(
  options: SearchTokensOptions,
): Promise<TokenAsset[]> {
  const query = options.query.trim();
  const axm = getAxmDiscoveryEntry();

  const local = dedupe([
    ...getPopularTokens(),
    ...DEFAULT_TOKEN_SEEDS,
    axm,
  ]).filter((t) => matchesQuery(t, query));

  let remoteHits: TokenAsset[] = [];
  if (query.length >= 1) {
    remoteHits = await remote.search(query, options.signal);
  }

  let onchain: TokenAsset | null = null;
  if (looksLikeMintAddress(query)) {
    const found =
      remoteHits.find((t) => t.mint === query) ||
      (await remote.getByMint(query, options.signal));
    if (!found) {
      onchain = await resolveMintOnChain(query, options.signal);
    }
  }

  let merged = dedupe([
    ...local,
    ...remoteHits,
    ...(onchain ? [onchain] : []),
  ]);

  if (options.excludeMint) {
    merged = merged.filter((t) => t.mint !== options.excludeMint);
  }

  // Keep coming-soon / live AXM visible for empty search or brand queries.
  const qLower = query.toLowerCase();
  if (
    !merged.some(isAxmToken) &&
    (!query || qLower.includes("axm") || qLower.includes("axiom"))
  ) {
    merged = [axm, ...merged];
  }

  merged = withWalletBalances(merged, options.balances);
  return prioritizeHeld(merged);
}

export async function resolveTokenByMint(
  mint: string,
  signal?: AbortSignal,
): Promise<TokenAsset | null> {
  if (mint === SOL_TOKEN.mint) return { ...SOL_TOKEN };
  if (mint === USDC_TOKEN.mint) return { ...USDC_TOKEN };

  const liveAxm = getAxmDiscoveryEntry();
  if (liveAxm.mint && liveAxm.mint === mint) return liveAxm;

  const remoteHit = await remote.getByMint(mint, signal);
  if (remoteHit) return remoteHit;

  return resolveMintOnChain(mint, signal);
}
