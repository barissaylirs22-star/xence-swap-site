import { POPULAR_TOKENS } from "@/lib/tokens/catalog";
import { isAxmToken } from "@/lib/tokens/axm";
import type { TokenAsset } from "@/lib/tokens/types";

export interface PortfolioMeta {
  symbol: string | null;
  name: string | null;
  iconUrl: string | null;
}

/** Resolve display meta only from already-known project token data. No extra RPC. */
export function resolvePortfolioMeta(
  mint: string,
  knownTokens: TokenAsset[] = [],
): PortfolioMeta {
  const pooled = [...knownTokens, ...POPULAR_TOKENS];
  const hit = pooled.find((token) => token.mint && token.mint === mint);
  if (!hit) {
    return { symbol: null, name: null, iconUrl: null };
  }
  const symbol = hit.symbol?.trim() || null;
  const name = hit.name?.trim() || null;
  const iconUrl =
    hit.iconUrl?.trim() ||
    (isAxmToken(hit) ? "/assets/axm-mark-512.png" : null);
  return {
    symbol: symbol && symbol !== "UNKNOWN" ? symbol : null,
    name: name && name !== "Unknown token" ? name : null,
    iconUrl,
  };
}
