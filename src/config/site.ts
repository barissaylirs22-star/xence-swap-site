import { BRAND } from "./launch";

export const SITE_ORIGIN = "https://axiom-swap.xyz" as const;
export const SITE_NAME = `${BRAND.name}` as const;

/**
 * Public community destinations.
 * GitHub URL is the live repo (legacy folder name).
 * X is omitted until an official Axiom handle is configured — do not invent one
 * and do not link the abandoned XenceSwap account.
 */
export const SOCIAL = {
  github: "https://github.com/barissaylirs22-star/xence-swap-site",
  /** Official Axiom X URL when known; null hides user-visible X links. */
  x: null as string | null,
} as const;

export const NAV_LINKS = [
  { href: "#live", label: "Live" },
  { href: "#trade", label: "Trade" },
  { href: "#journey", label: "Journey" },
  { href: "#vision", label: "Signal" },
  { href: "#launch", label: "Launch" },
  { href: "#community", label: "Community" },
] as const;
