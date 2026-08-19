import { BRAND } from "./launch";

export const SITE_ORIGIN = "https://axiom-swap.xyz" as const;
export const SITE_NAME = `${BRAND.name}` as const;

/**
 * Public community destinations.
 * GitHub URL is the live repo (legacy folder name).
 */
export const SOCIAL = {
  github: "https://github.com/barissaylirs22-star/xence-swap-site",
  /** Official Axiom X account. */
  x: "https://x.com/AXM_SWAP",
} as const;

export const NAV_LINKS = [
  { href: "#live", label: "Live" },
  { href: "#trade", label: "Trade" },
  { href: "#journey", label: "Journey" },
  { href: "#vision", label: "Signal" },
  { href: "#launch", label: "Launch" },
  { href: "#community", label: "Community" },
] as const;
