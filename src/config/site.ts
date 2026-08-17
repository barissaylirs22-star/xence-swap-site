import { BRAND } from "./launch";

export const SITE_ORIGIN = "https://axiom-swap.xyz" as const;
export const SITE_NAME = `${BRAND.name}` as const;

/**
 * Public community destinations.
 * GitHub URL is the live repo (legacy folder name). X handle is still the
 * historical account until an official Axiom handle is configured — do not invent one.
 */
export const SOCIAL = {
  github: "https://github.com/barissaylirs22-star/xence-swap-site",
  x: "https://x.com/XenceSwap",
} as const;

export const NAV_LINKS = [
  { href: "#journey", label: "Journey" },
  { href: "#vision", label: "Signal" },
  { href: "#launch", label: "Launch" },
  { href: "#trade", label: "Trade" },
  { href: "#community", label: "Community" },
] as const;
