import { SWAP_COPY } from "@/content/swap";
import {
  logConnectedWalletDiagnostics,
  logReadinessBlockReason,
  logWalletProviderDiagnostics,
} from "@/lib/wallet/diagnostics";
import type { ConnectedWallet } from "@/lib/wallet/types";
import { SOL_MINT, SOL_TOKEN } from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";
import { toRawAmount } from "./amounts";
import { fetchTokenUiBalance } from "./balances";
import { requireSwapRouter } from "./createRouter";
import {
  executeSwap,
  resolvePendingSwapFlight,
} from "./execute";
import { SwapError } from "./errors";
import { assertCanExecuteSwaps } from "./gate";
import { isMaterialQuoteChange } from "./materialChange";
import { assertMainnetRpc } from "./network";
import {
  assertQuoteMatchesPair,
  assertQuotePairIntegrity,
} from "./pairGuard";
import { isQuoteFresh } from "./quoteFreshness";
import {
  hasSolFeeReserve,
  isNativeSolToken,
  validatePayAmount,
} from "./spendable";
import { getPendingSwapFlight } from "./submitLock";
import type { SwapExecutionResult, SwapQuote } from "./types";

export type ConfirmExecuteOutcome =
  | { status: "success"; result: SwapExecutionResult; quote: SwapQuote }
  | { status: "needs_reconfirm"; quote: SwapQuote; message: string }
  | { status: "pending"; signature: string | null; message: string }
  | { status: "error"; message: string };

function pendingOutcome(
  signature: string | null,
  message: string = SWAP_COPY.confirmationUnknown,
): ConfirmExecuteOutcome {
  return { status: "pending", signature, message };
}

/**
 * Confirm Swap orchestration:
 * pair/amount integrity → RPC/balance checks → fresh quote →
 * material-change gate → build/sign/send/confirm.
 * Does not auto-run; only called from the Confirm button.
 */
export async function confirmAndExecuteSwap(options: {
  wallet: ConnectedWallet;
  payToken: TokenAsset;
  receiveToken: TokenAsset;
  payAmount: string;
  payBalanceUi: number | null;
  slippageBps: number;
  reviewedQuote: SwapQuote;
  signal?: AbortSignal;
  onPhase?: (
    phase:
      | "revalidate"
      | "quote"
      | "wallet"
      | "submitted"
      | "confirming",
    detail?: { signature?: string },
  ) => void;
}): Promise<ConfirmExecuteOutcome> {
  try {
    assertCanExecuteSwaps();
    options.onPhase?.("revalidate");
    logWalletProviderDiagnostics("confirm.revalidate");
    logConnectedWalletDiagnostics(options.wallet, "confirm.wallet");

    if (!options.wallet.publicKey) {
      logReadinessBlockReason("wallet_public_key_missing");
      return { status: "error", message: SWAP_COPY.disconnected };
    }

    const pending = getPendingSwapFlight();
    if (pending) {
      const resolved = await resolvePendingSwapFlight(options.signal);
      if (resolved.status === "confirmed") {
        return {
          status: "success",
          result: { signature: resolved.signature, confirmed: true },
          quote: options.reviewedQuote,
        };
      }
      if (resolved.status === "pending") {
        return pendingOutcome(resolved.signature, resolved.message);
      }
      if (resolved.status === "failed" || resolved.status === "expired") {
        return { status: "error", message: resolved.message };
      }
    }

    if (
      options.payToken.decimals === null ||
      options.receiveToken.decimals === null
    ) {
      return { status: "error", message: SWAP_COPY.unsupportedToken };
    }

    const amountRaw = toRawAmount(
      options.payAmount,
      options.payToken.decimals,
    );
    if (!amountRaw || amountRaw === "0") {
      return { status: "error", message: SWAP_COPY.invalidAmount };
    }

    // Reviewed quote must still match the displayed pair/amount.
    // Do NOT require its TTL here — a fresh quote is fetched after RPC checks.
    assertQuotePairIntegrity({
      quote: options.reviewedQuote,
      payToken: options.payToken,
      receiveToken: options.receiveToken,
      payAmountRaw: amountRaw,
    });
    if (options.reviewedQuote.slippageBps !== options.slippageBps) {
      throw new SwapError("invalid_request", SWAP_COPY.pairMismatch);
    }

    try {
      await assertMainnetRpc(options.signal);
    } catch (error) {
      logReadinessBlockReason(
        "mainnet_rpc_check_failed",
        error instanceof SwapError ? error.code : "unknown",
      );
      throw error;
    }

    // Live balance re-check (fail closed on RPC issues).
    const liveBalance = await fetchTokenUiBalance({
      owner: options.wallet.publicKey,
      mint: options.payToken.mint,
      decimals: options.payToken.decimals,
      signal: options.signal,
    });
    if (liveBalance.status !== "ok" || liveBalance.uiAmount === null) {
      return { status: "error", message: SWAP_COPY.balanceUnavailable };
    }

    const amountOk = validatePayAmount({
      amount: options.payAmount,
      token: options.payToken,
      balanceUi: liveBalance.uiAmount,
      walletConnected: true,
    });
    if (!amountOk.ok) {
      if (amountOk.issue === "sol_reserve") {
        return { status: "error", message: SWAP_COPY.solReserve };
      }
      if (amountOk.issue === "insufficient") {
        return { status: "error", message: SWAP_COPY.insufficient };
      }
      return { status: "error", message: SWAP_COPY.invalidAmount };
    }

    if (!isNativeSolToken(options.payToken)) {
      const solDecimals = SOL_TOKEN.decimals ?? 9;
      const solBalance = await fetchTokenUiBalance({
        owner: options.wallet.publicKey,
        mint: SOL_MINT,
        decimals: solDecimals,
        signal: options.signal,
      });
      if (solBalance.status !== "ok" || solBalance.uiAmount === null) {
        return { status: "error", message: SWAP_COPY.balanceUnavailable };
      }
      if (!hasSolFeeReserve(solBalance.uiAmount)) {
        return { status: "error", message: SWAP_COPY.solReserve };
      }
    }

    options.onPhase?.("quote");
    const router = requireSwapRouter();
    const freshQuote = await router.getQuote({
      inputMint: options.payToken.mint,
      outputMint: options.receiveToken.mint,
      amountRaw,
      slippageBps: options.slippageBps,
      signal: options.signal,
    });

    if (!isQuoteFresh(freshQuote)) {
      return { status: "error", message: SWAP_COPY.staleQuote };
    }

    assertQuoteMatchesPair({
      quote: freshQuote,
      payToken: options.payToken,
      receiveToken: options.receiveToken,
      payAmountRaw: amountRaw,
    });

    if (freshQuote.slippageBps !== options.slippageBps) {
      return { status: "error", message: SWAP_COPY.quoteUnavailable };
    }

    if (isMaterialQuoteChange(options.reviewedQuote, freshQuote)) {
      return {
        status: "needs_reconfirm",
        quote: freshQuote,
        message: SWAP_COPY.valuesUpdated,
      };
    }

    const result = await executeSwap({
      quote: freshQuote,
      wallet: options.wallet,
      signal: options.signal,
      manageLock: false,
      onPhase: (phase, detail) => options.onPhase?.(phase, detail),
    });

    if (!result.confirmed || !result.signature) {
      return { status: "error", message: SWAP_COPY.failure };
    }

    return { status: "success", result, quote: freshQuote };
  } catch (error) {
    if (error instanceof SwapError) {
      if (error.code === "confirmation_unknown") {
        return pendingOutcome(error.signature, error.publicMessage);
      }
      return { status: "error", message: error.publicMessage };
    }
    return { status: "error", message: SWAP_COPY.failure };
  }
}
