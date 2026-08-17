/**
 * Process-wide submit lock for swap execution.
 * Blocks double-submit / overlapping Phantom prompts.
 */
let locked = false;
let lockOwner: string | null = null;

export function isSwapSubmitLocked(): boolean {
  return locked;
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
