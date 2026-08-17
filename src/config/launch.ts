/**
 * Axiom launch configuration — single source of truth for the future token.
 *
 * PRE-LAUNCH (current): leave `isLive` false and `mint` null.
 * AFTER Pump.fun launch:
 *   1. Paste the new Pump.fun mint into `mint`
 *   2. Set `pumpFunUrl` to the coin page (optional; auto-built from mint)
 *   3. Set `isLive` to true
 *   4. Optionally set `status` to "live"
 *
 * Never invent a mint. Never reuse an abandoned legacy mint.
 * AXM token discovery / AXM trading eligibility activate only when live + mint.
 * The general Axiom Swap terminal is independent — see `config/swap.ts`.
 */

export const BRAND = {
  name: "Axiom",
  symbol: "AXM",
  tagline: "A new Solana launch, built in public.",
} as const;

export type LaunchStatus = "prelaunch" | "live";

export const LAUNCH = {
  /** Product phase shown across the site */
  status: "prelaunch" as LaunchStatus,

  /**
   * Set true only after the new Pump.fun AXM token is live.
   * Does not gate the general Solana swap terminal.
   */
  isLive: false,

  /**
   * Pump.fun mint for the new token only.
   * Leave null until launch — never invent or paste a legacy address.
   */
  mint: null as string | null,

  /**
   * Optional decimals for the new token after launch.
   * Leave null to resolve from on-chain / metadata — never assume.
   */
  decimals: null as number | null,

  /**
   * Official Pump.fun coin URL after launch.
   * Example: https://pump.fun/coin/<mint>
   */
  pumpFunUrl: null as string | null,

  /** Human-readable launch platform label */
  platform: "Pump.fun",

  /** Optional ISO date string for countdown UI (null = no countdown) */
  targetLaunchAt: null as string | null,
};

/** True only when the AXM project token is configured as live. */
export function isLaunchLive(): boolean {
  return (
    LAUNCH.isLive === true &&
    typeof LAUNCH.mint === "string" &&
    LAUNCH.mint.length > 0
  );
}

export function getActiveMint(): string | null {
  return isLaunchLive() ? LAUNCH.mint : null;
}

export function getPumpFunUrl(): string | null {
  if (!isLaunchLive()) return null;
  if (LAUNCH.pumpFunUrl) return LAUNCH.pumpFunUrl;
  if (LAUNCH.mint) return `https://pump.fun/coin/${LAUNCH.mint}`;
  return null;
}
