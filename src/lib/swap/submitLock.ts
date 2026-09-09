/**
 * Process-wide submit lock for swap execution.
 * Blocks double-submit / overlapping Phantom prompts.
 *
 * Unresolved flights (broadcast with unknown confirmation) survive mutex
 * release so a second swap cannot be sent while the first may still land.
 */

export interface PendingSwapFlight {
  signature: string | null;
  blockhash: string;
  lastValidBlockHeight: number;
  walletPublicKey: string;
}

let locked = false;
let lockOwner: string | null = null;
let pendingFlight: PendingSwapFlight | null = null;

export function isSwapSubmitLocked(): boolean {
  return locked;
}

export function getPendingSwapFlight(): PendingSwapFlight | null {
  return pendingFlight;
}

export function hasUnresolvedSwapFlight(): boolean {
  return pendingFlight !== null;
}

/** True when a new swap must not be built/sent. */
export function isSwapResubmitBlocked(): boolean {
  return locked || pendingFlight !== null;
}

export function acquireSwapSubmitLock(owner: string): boolean {
  if (locked) return false;
  locked = true;
  lockOwner = owner;
  return true;
}

export function releaseSwapSubmitLock(owner?: string): void {
  if (owner && lockOwner && owner !== lockOwner) return;
  locked = false;
  lockOwner = null;
}

export function rememberSwapFlight(flight: PendingSwapFlight): void {
  pendingFlight = {
    signature: flight.signature,
    blockhash: flight.blockhash,
    lastValidBlockHeight: flight.lastValidBlockHeight,
    walletPublicKey: flight.walletPublicKey,
  };
}

export function updatePendingSwapSignature(signature: string): void {
  if (!pendingFlight) return;
  pendingFlight = { ...pendingFlight, signature };
}

export function clearPendingSwapFlight(): void {
  pendingFlight = null;
}
