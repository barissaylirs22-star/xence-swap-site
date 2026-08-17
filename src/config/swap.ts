/**
 * General Axiom Swap terminal feature flags.
 * Independent from AXM project launch status in `launch.ts`.
 */

export interface SwapFeatureFlags {
  /** Terminal UI, token search, and selection are available. */
  terminalEnabled: boolean;
  /**
   * Real quote fetching for tradeable pairs (e.g. SOL/USDC).
   * Never fabricate quotes when this is true — fail closed instead.
   */
  quotesEnabled: boolean;
  /**
   * Real swap transaction build/sign/send.
   * Enabled for controlled mainnet testing — still requires user Confirm + Phantom approval.
   */
  executionEnabled: boolean;
}

export const SWAP_FEATURES: SwapFeatureFlags = {
  terminalEnabled: true,
  quotesEnabled: true,
  executionEnabled: true,
};
