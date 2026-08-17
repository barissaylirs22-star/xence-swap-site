import type { TokenAsset } from "@/lib/tokens/types";

export type SwapSide = "pay" | "receive";

export type SwapUiState =
  | "preview"
  | "disconnected"
  | "ready"
  | "quoting"
  | "quote_unavailable"
  | "insufficient_balance"
  | "execution_disabled"
  | "pending"
  | "success"
  | "failure";

/** @deprecated Prefer TokenAsset from @/lib/tokens/types */
export type SwapToken = TokenAsset;

export interface SwapPair {
  base: TokenAsset;
  quote: TokenAsset;
}

export interface RouteHop {
  label: string;
  percent: number;
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmountRaw: string;
  outAmountRaw: string;
  minOutAmountRaw: string;
  slippageBps: number;
  priceImpactPct: number | null;
  routeSummary: string;
  hops: RouteHop[];
  /** Opaque provider payload required to build the swap transaction. */
  providerPayload: unknown;
  quotedAt: number;
  expiresAt: number;
}

export interface QuoteRequest {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  slippageBps: number;
  signal?: AbortSignal;
}

export interface BuildSwapRequest {
  quote: SwapQuote;
  userPublicKey: string;
  signal?: AbortSignal;
}

export interface BuiltSwapTransaction {
  /** Base64-encoded unsigned versioned transaction */
  transactionBase64: string;
  lastValidBlockHeight?: number;
}

export interface SwapExecutionResult {
  signature: string;
  /** True only after Solana RPC confirmation — never after sign alone. */
  confirmed: boolean;
}

export interface SwapRouter {
  readonly id: string;
  getQuote(request: QuoteRequest): Promise<SwapQuote>;
  buildSwapTransaction(
    request: BuildSwapRequest,
  ): Promise<BuiltSwapTransaction>;
}
