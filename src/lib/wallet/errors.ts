export type WalletErrorCode =
  | "not_installed"
  | "rejected"
  | "locked"
  | "failed"
  | "unsupported";

export class WalletError extends Error {
  readonly code: WalletErrorCode;

  constructor(code: WalletErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "WalletError";
    this.code = code;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error ?? "");
  const err = error as { code?: number | string; message?: string; name?: string };
  return `${err.message ?? ""} ${err.name ?? ""} ${err.code ?? ""}`.toLowerCase();
}

export function isUserRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: number; message?: string; name?: string };
  if (err.code === 4001) return true;
  const msg = errorText(error);
  return (
    msg.includes("user rejected") ||
    msg.includes("rejected the request") ||
    msg.includes("user cancelled") ||
    msg.includes("user canceled") ||
    msg.includes("denied")
  );
}

export function isWalletLocked(error: unknown): boolean {
  const msg = errorText(error);
  return (
    msg.includes("wallet is locked") ||
    msg.includes("please unlock") ||
    msg.includes("unlock your wallet") ||
    msg.includes("locked")
  );
}

export function toPublicWalletMessage(error: unknown): string {
  if (error instanceof WalletError) return error.message;
  if (isUserRejection(error)) return "Connection cancelled.";
  if (isWalletLocked(error)) {
    return "Phantom is locked. Unlock it, then try again.";
  }
  return "Could not connect wallet. Please try again.";
}
