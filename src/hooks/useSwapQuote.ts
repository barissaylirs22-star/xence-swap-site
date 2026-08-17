import { useEffect, useState } from "react";
import {
  DEFAULT_SLIPPAGE_BPS,
  QUOTE_REFETCH_MS,
} from "@/config/providers";
import { SWAP_COPY } from "@/content/swap";
import { toRawAmount, isPositiveAmount } from "@/lib/swap/amounts";
import { requireSwapRouter } from "@/lib/swap/createRouter";
import { SwapError, toPublicSwapMessage } from "@/lib/swap/errors";
import { canFetchQuotes } from "@/lib/swap/gate";
import { isQuoteFresh } from "@/lib/swap/quoteFreshness";
import { clampSlippageBps } from "@/lib/swap/slippage";
import { isValidAmountShape } from "@/lib/swap/spendable";
import type { SwapQuote } from "@/lib/swap/types";
import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";

interface UseSwapQuoteArgs {
  payToken: TokenAsset;
  receiveToken: TokenAsset;
  payAmount: string;
  slippageBps?: number;
  enabled?: boolean;
  /** Bump after a successful swap to drop any stale in-memory quote. */
  resetKey?: number;
}

interface UseSwapQuoteResult {
  quote: SwapQuote | null;
  loading: boolean;
  error: string | null;
  fresh: boolean;
}

export function useSwapQuote({
  payToken,
  receiveToken,
  payAmount,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  enabled = true,
  resetKey = 0,
}: UseSwapQuoteArgs): UseSwapQuoteResult {
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const safeSlippage = clampSlippageBps(slippageBps);

  useEffect(() => {
    // Explicit post-swap reset — never reuse a prior quote/tx context.
    if (resetKey > 0 && !payAmount.trim()) {
      setQuote(null);
      setLoading(false);
      setError(null);
    }
  }, [resetKey, payAmount]);

  useEffect(() => {
    if (!enabled || !canFetchQuotes()) {
      setQuote(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!payAmount.trim() || !isPositiveAmount(payAmount)) {
      setQuote(null);
      setLoading(false);
      setError(null);
      return;
    }

    if (!isValidAmountShape(payAmount)) {
      setQuote(null);
      setLoading(false);
      setError(SWAP_COPY.invalidAmount);
      return;
    }

    if (
      !looksLikeMintAddress(payToken.mint) ||
      !looksLikeMintAddress(receiveToken.mint) ||
      !payToken.selectable ||
      !receiveToken.selectable
    ) {
      setQuote(null);
      setLoading(false);
      setError(SWAP_COPY.unsupportedToken);
      return;
    }

    if (payToken.decimals === null || receiveToken.decimals === null) {
      setQuote(null);
      setLoading(false);
      setError(SWAP_COPY.unsupportedToken);
      return;
    }

    if (payToken.mint === receiveToken.mint) {
      setQuote(null);
      setLoading(false);
      setError(SWAP_COPY.quoteUnavailable);
      return;
    }

    const amountRaw = toRawAmount(payAmount, payToken.decimals);
    if (!amountRaw || amountRaw === "0") {
      setQuote(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let expireTimer: number | undefined;

    const clearExpireTimer = () => {
      if (expireTimer !== undefined) window.clearTimeout(expireTimer);
      expireTimer = undefined;
    };

    const armExpireTimer = (next: SwapQuote) => {
      clearExpireTimer();
      const delay = Math.max(0, next.expiresAt - Date.now());
      expireTimer = window.setTimeout(() => {
        if (cancelled) return;
        setQuote((current) => {
          if (current && !isQuoteFresh(current)) {
            setError(SWAP_COPY.staleQuote);
            return null;
          }
          return current;
        });
      }, delay + 25);
    };

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const router = requireSwapRouter();
        const next = await router.getQuote({
          inputMint: payToken.mint,
          outputMint: receiveToken.mint,
          amountRaw,
          slippageBps: safeSlippage,
          signal: controller.signal,
        });
        if (cancelled || controller.signal.aborted) return;

        if (!isQuoteFresh(next)) {
          setQuote(null);
          setError(SWAP_COPY.staleQuote);
          setLoading(false);
          return;
        }

        // Slippage on the quote must match what we requested.
        if (next.slippageBps !== safeSlippage) {
          setQuote(null);
          setError(SWAP_COPY.quoteUnavailable);
          setLoading(false);
          return;
        }

        setQuote(next);
        setLoading(false);
        armExpireTimer(next);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setQuote(null);
        setLoading(false);
        clearExpireTimer();
        if (err instanceof SwapError && err.code === "gated") {
          setError(null);
          return;
        }
        setError(toPublicSwapMessage(err));
      }
    };

    void run();
    const timer = window.setInterval(() => void run(), QUOTE_REFETCH_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      clearExpireTimer();
    };
  }, [
    enabled,
    resetKey,
    payAmount,
    payToken.decimals,
    payToken.mint,
    payToken.selectable,
    receiveToken.decimals,
    receiveToken.mint,
    receiveToken.selectable,
    safeSlippage,
  ]);

  return {
    quote,
    loading,
    error,
    fresh: isQuoteFresh(quote),
  };
}
