import { assertCanExecuteSwaps, assertCanFetchQuotes } from "@/lib/swap/gate";
import { SwapError } from "@/lib/swap/errors";
import { clampSlippageBps } from "@/lib/swap/slippage";
import type {
  BuildSwapRequest,
  BuiltSwapTransaction,
  QuoteRequest,
  SwapQuote,
  SwapRouter,
} from "@/lib/swap/types";
import { jupiterBuildSwap, jupiterGetQuote } from "./client";
import { mapJupiterQuote, mapJupiterSwapTransaction } from "./mapper";

/**
 * Jupiter-backed router. UI never imports this directly —
 * use `getSwapRouter()` from the factory.
 */
export class JupiterSwapRouter implements SwapRouter {
  readonly id = "jupiter-swap-v1";

  async getQuote(request: QuoteRequest): Promise<SwapQuote> {
    assertCanFetchQuotes();

    if (
      !request.inputMint ||
      !request.outputMint ||
      !request.amountRaw ||
      request.amountRaw === "0" ||
      request.inputMint === request.outputMint
    ) {
      throw new SwapError("invalid_request", "Enter a valid amount to continue.");
    }

    const slippageBps = clampSlippageBps(request.slippageBps);

    const params = new URLSearchParams({
      inputMint: request.inputMint,
      outputMint: request.outputMint,
      amount: request.amountRaw,
      slippageBps: String(slippageBps),
      restrictIntermediateTokens: "true",
    });

    try {
      const raw = await jupiterGetQuote(params, request.signal);
      return mapJupiterQuote(raw, {
        inputMint: request.inputMint,
        outputMint: request.outputMint,
        amountRaw: request.amountRaw,
        slippageBps,
      });
    } catch (err) {
      if (err instanceof SwapError) {
        if (err.code === "quote_unavailable" || err.code === "network") {
          throw new SwapError(
            "quote_unavailable",
            "No trading route available.",
            err,
          );
        }
        throw err;
      }
      throw new SwapError(
        "quote_unavailable",
        "No trading route available.",
        err,
      );
    }
  }

  async buildSwapTransaction(
    request: BuildSwapRequest,
  ): Promise<BuiltSwapTransaction> {
    assertCanExecuteSwaps();

    if (!request.userPublicKey) {
      throw new SwapError("invalid_request", "Connect a wallet to continue.");
    }

    if (Date.now() > request.quote.expiresAt) {
      throw new SwapError(
        "stale_quote",
        "Quote expired. Request a fresh quote and try again.",
      );
    }

    if (
      request.quote.inputMint === request.quote.outputMint ||
      !request.quote.providerPayload
    ) {
      throw new SwapError("build_failed", "Could not prepare the swap.");
    }

    const raw = await jupiterBuildSwap(
      {
        quoteResponse: request.quote.providerPayload,
        userPublicKey: request.userPublicKey,
        dynamicComputeUnitLimit: true,
        wrapAndUnwrapSol: true,
      },
      request.signal,
    );

    return mapJupiterSwapTransaction(raw);
  }
}
