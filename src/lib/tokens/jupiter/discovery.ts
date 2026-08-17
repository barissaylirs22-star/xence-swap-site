import {
  JUPITER_API_BASE,
  JUPITER_CLIENT_API_KEY,
  JUPITER_LITE_API_BASE,
  JUPITER_TOKENS_SEARCH_PATH,
  SWAP_PROXY_URL,
} from "@/config/providers";
import { SOL_MINT } from "../catalog";
import type { TokenAsset, TokenDiscoveryProvider } from "../types";

function tokensApiBase(): string {
  if (SWAP_PROXY_URL) return `${SWAP_PROXY_URL.replace(/\/$/, "")}`;
  if (JUPITER_CLIENT_API_KEY) return JUPITER_API_BASE;
  return JUPITER_LITE_API_BASE;
}

function headers(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  if (JUPITER_CLIENT_API_KEY && !SWAP_PROXY_URL) {
    h["x-api-key"] = JUPITER_CLIENT_API_KEY;
  }
  return h;
}

interface JupiterMintInfo {
  id?: string;
  address?: string;
  mint?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  icon?: string;
  logoURI?: string;
  tags?: string[];
  isVerified?: boolean;
  organicScoreLabel?: string;
}

function mapToken(raw: JupiterMintInfo): TokenAsset | null {
  const mint = raw.id || raw.address || raw.mint;
  if (!mint || typeof mint !== "string") return null;

  const verified =
    raw.isVerified === true ||
    (Array.isArray(raw.tags) && raw.tags.includes("verified"));

  const warnings: TokenAsset["warnings"] = [];
  if (!verified) warnings.push("unverified");

  return {
    mint,
    symbol: (raw.symbol || "UNKNOWN").slice(0, 16),
    name: raw.name || "Unknown token",
    decimals: typeof raw.decimals === "number" ? raw.decimals : null,
    iconUrl: raw.icon || raw.logoURI || null,
    isNativeSol: mint === SOL_MINT,
    verified,
    selectable: true,
    warnings: warnings.length ? warnings : undefined,
  };
}

async function searchRemote(
  query: string,
  signal?: AbortSignal,
): Promise<TokenAsset[]> {
  const url = `${tokensApiBase()}${JUPITER_TOKENS_SEARCH_PATH}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: headers() });
  if (!res.ok) return [];

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => mapToken(item as JupiterMintInfo))
    .filter((t): t is TokenAsset => t !== null);
}

/** Provider-backed discovery — UI never imports this module directly. */
export class JupiterTokenDiscovery implements TokenDiscoveryProvider {
  readonly id = "jupiter-tokens-v2";

  async search(query: string, signal?: AbortSignal): Promise<TokenAsset[]> {
    const q = query.trim();
    if (!q) return [];
    try {
      return await searchRemote(q, signal);
    } catch {
      return [];
    }
  }

  async getByMint(
    mint: string,
    signal?: AbortSignal,
  ): Promise<TokenAsset | null> {
    const results = await this.search(mint, signal);
    return results.find((t) => t.mint === mint) ?? results[0] ?? null;
  }
}
