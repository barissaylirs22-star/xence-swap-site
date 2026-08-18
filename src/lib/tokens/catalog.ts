import type { TokenAsset } from "./types";

/** Well-known Solana mints used as safe defaults / seeds — not the full catalog. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
export const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
export const WIF_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
export const PYTH_MINT = "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3";
export const JTO_MINT = "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL";

export const SOL_TOKEN: TokenAsset = {
  mint: SOL_MINT,
  symbol: "SOL",
  name: "Solana",
  decimals: 9,
  isNativeSol: true,
  verified: true,
  selectable: true,
  iconUrl: null,
};

export const USDC_TOKEN: TokenAsset = {
  mint: USDC_MINT,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  verified: true,
  selectable: true,
  iconUrl: null,
};

const USDT_TOKEN: TokenAsset = {
  mint: USDT_MINT,
  symbol: "USDT",
  name: "Tether USD",
  decimals: 6,
  verified: true,
  selectable: true,
  iconUrl: null,
};

const JUP_TOKEN: TokenAsset = {
  mint: JUP_MINT,
  symbol: "JUP",
  name: "Jupiter",
  decimals: 6,
  verified: true,
  selectable: true,
  iconUrl: null,
};

const BONK_TOKEN: TokenAsset = {
  mint: BONK_MINT,
  symbol: "BONK",
  name: "Bonk",
  decimals: 5,
  verified: true,
  selectable: true,
  iconUrl: null,
};

const WIF_TOKEN: TokenAsset = {
  mint: WIF_MINT,
  symbol: "WIF",
  name: "dogwifhat",
  decimals: 6,
  verified: true,
  selectable: true,
  iconUrl: null,
};

const PYTH_TOKEN: TokenAsset = {
  mint: PYTH_MINT,
  symbol: "PYTH",
  name: "Pyth Network",
  decimals: 6,
  verified: true,
  selectable: true,
  iconUrl: null,
};

const JTO_TOKEN: TokenAsset = {
  mint: JTO_MINT,
  symbol: "JTO",
  name: "Jito",
  decimals: 9,
  verified: true,
  selectable: true,
  iconUrl: null,
};

/** Trusted popular Solana ecosystem tokens (fallback when remote data is down). */
export const POPULAR_TOKENS: TokenAsset[] = [
  SOL_TOKEN,
  USDC_TOKEN,
  USDT_TOKEN,
  JUP_TOKEN,
  BONK_TOKEN,
  WIF_TOKEN,
  PYTH_TOKEN,
  JTO_TOKEN,
];

/** Seed list for empty search / offline fallback. Discovery expands beyond this. */
export const DEFAULT_TOKEN_SEEDS: TokenAsset[] = [SOL_TOKEN, USDC_TOKEN];

export function getDefaultPayToken(): TokenAsset {
  return { ...SOL_TOKEN };
}

export function getDefaultReceiveToken(): TokenAsset {
  return { ...USDC_TOKEN };
}

export function getPopularTokens(): TokenAsset[] {
  return POPULAR_TOKENS.map((t) => ({ ...t }));
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Fast shape check — not a full cryptographic validation. */
export function looksLikeMintAddress(value: string): boolean {
  const q = value.trim();
  if (!BASE58_RE.test(q)) return false;
  return q.length >= 32 && q.length <= 44;
}

export function shortMint(mint: string): string {
  if (!mint || mint.length < 8) return mint || "—";
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function formatVolumeUsd(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

/**
 * Compact % change for tight UI cells. Display-only — does not alter the raw value.
 * Examples: +12.3% · +123.0% · +999.0% · +15.7K% · -2.4M%
 */
export function formatChangePct(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M%`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K%`;
  return `${sign}${abs.toFixed(1)}%`;
}

/** Compact token price for discovery rows — null when unavailable (never estimate). */
export function formatTokenPriceUsd(
  value: number | null | undefined,
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value === 0) return "$0";
  if (value >= 1000) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  if (value >= 0.0001) return `$${value.toFixed(6)}`;
  return `$${value.toExponential(2)}`;
}

/** Prefer market cap; fall back to FDV. Returns label + formatted value, or null. */
export function formatCapOrFdv(
  marketCapUsd: number | null | undefined,
  fdvUsd: number | null | undefined,
): { label: string; value: string } | null {
  const mc = formatVolumeUsd(marketCapUsd ?? null);
  if (mc) return { label: "MC", value: mc };
  const fdv = formatVolumeUsd(fdvUsd ?? null);
  if (fdv) return { label: "FDV", value: fdv };
  return null;
}
