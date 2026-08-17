import { BRAND, getActiveMint, LAUNCH } from "@/config/launch";
import { isAxmLive } from "@/lib/swap/gate";
import type { TokenAsset } from "./types";

/** Pre-launch AXM row — never invents a mint, never selectable for trading. */
export function getAxmComingSoonToken(): TokenAsset {
  return {
    mint: "",
    symbol: BRAND.symbol,
    name: `${BRAND.name} — Coming soon`,
    decimals: null,
    verified: false,
    selectable: false,
    warnings: ["coming_soon"],
    iconUrl: "/assets/axm-mark-512.png",
  };
}

/** Live AXM asset from launch config only. */
export function getAxmLiveToken(): TokenAsset | null {
  if (!isAxmLive()) return null;
  const mint = getActiveMint();
  if (!mint) return null;

  return {
    mint,
    symbol: BRAND.symbol,
    name: BRAND.name,
    decimals: LAUNCH.decimals,
    verified: true,
    selectable: true,
    iconUrl: "/assets/axm-mark-512.png",
  };
}

export function getAxmDiscoveryEntry(): TokenAsset {
  return getAxmLiveToken() ?? getAxmComingSoonToken();
}

export function isAxmToken(token: TokenAsset): boolean {
  if (token.symbol === BRAND.symbol && !token.mint) return true;
  const live = getActiveMint();
  return Boolean(live && token.mint === live);
}
