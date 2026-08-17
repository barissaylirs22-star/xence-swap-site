export type SwapErrorCode =
  | "gated"
  | "invalid_request"
  | "quote_unavailable"
  | "stale_quote"
  | "build_failed"
  | "wallet_rejected"
  | "send_failed"
  | "network"
  | "wrong_network"
  | "insufficient_balance"
  | "unsupported_token"
  | "in_flight"
  | "slippage_exceeded"
  | "simulation_failed"
  | "confirmation_timeout"
  | "unknown";

export class SwapError extends Error {
  readonly code: SwapErrorCode;
  readonly publicMessage: string;

  constructor(code: SwapErrorCode, publicMessage: string, cause?: unknown) {
    super(publicMessage);
    this.name = "SwapError";
    this.code = code;
    this.publicMessage = publicMessage;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** User-facing copy only — never leak provider/config internals. */
export function toPublicSwapMessage(error: unknown): string {
  if (error instanceof SwapError) {
    if (error.code === "quote_unavailable") {
      return "No trading route available.";
    }
    return error.publicMessage;
  }
  return "Something went wrong. Please try again.";
}
