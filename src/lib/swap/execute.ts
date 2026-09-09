import {
  VersionedTransaction,
} from "@solana/web3.js";
import { SWAP_COPY } from "@/content/swap";
import {
  classifyExecutionRpcError,
  isAlreadyProcessedError,
  sendRawTransactionSequential,
  signatureFromSignedTx,
  withExecutionReadFailover,
} from "@/lib/solana/executionRpc";
import type { ConnectedWallet } from "@/lib/wallet/types";
import { requireExecutionRouter } from "./createRouter";
import { SwapError } from "./errors";
import { assertCanExecuteSwaps } from "./gate";
import { assertMainnetRpc } from "./network";
import { isQuoteFresh } from "./quoteFreshness";
import {
  acquireSwapSubmitLock,
  clearPendingSwapFlight,
  getPendingSwapFlight,
  rememberSwapFlight,
  releaseSwapSubmitLock,
  updatePendingSwapSignature,
  type PendingSwapFlight,
} from "./submitLock";
import type { SwapExecutionResult, SwapQuote } from "./types";

export type ExecutePhase = "wallet" | "submitted" | "confirming";

export type PendingFlightResolution =
  | { status: "confirmed"; signature: string }
  | { status: "failed"; message: string }
  | { status: "expired"; message: string }
  | { status: "pending"; signature: string | null; message: string };

function decodeTransaction(base64: string): VersionedTransaction {
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return VersionedTransaction.deserialize(bytes);
  } catch (cause) {
    throw new SwapError("build_failed", "Could not prepare the swap.", cause);
  }
}

function flightOwner(quote: SwapQuote, wallet: ConnectedWallet): string {
  return [
    wallet.publicKey,
    quote.inputMint,
    quote.outputMint,
    quote.inAmountRaw,
    quote.quotedAt,
  ].join(":");
}

function mapSendError(cause: unknown, signature?: string | null): SwapError {
  if (cause instanceof SwapError) return cause;
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  const lower = raw.toLowerCase();

  if (/reject|cancel|denied|user rejected/i.test(raw)) {
    return new SwapError("wallet_rejected", "Transaction cancelled", cause);
  }
  if (/blockhash not found|block height exceeded|expired/i.test(lower)) {
    return new SwapError("stale_quote", "Transaction expired", cause, signature);
  }
  if (/slippage|0x1771|custom program error: 6001/i.test(lower)) {
    return new SwapError("slippage_exceeded", "Slippage exceeded", cause, signature);
  }
  if (/simulation failed|insufficient funds|insufficient lamports/i.test(lower)) {
    return new SwapError(
      "simulation_failed",
      "Transaction failed",
      cause,
      signature,
    );
  }
  if (/403|429|network|fetch|failed to fetch|timed out|timeout/i.test(lower)) {
    return new SwapError("network", "RPC/network error", cause, signature);
  }
  return new SwapError("send_failed", "Transaction failed", cause, signature);
}

function throwUnknownConfirmation(
  signature: string | null,
  cause?: unknown,
): never {
  throw new SwapError(
    "confirmation_unknown",
    SWAP_COPY.confirmationUnknown,
    cause,
    signature,
  );
}

/**
 * Fail-closed RPC simulation of the built (unsigned) transaction.
 * Sequential infra failover only — simulation program errors do not fail over.
 */
async function assertPreApproveSimulation(
  tx: VersionedTransaction,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new SwapError("wallet_rejected", "Transaction cancelled");
  }

  const response = await withExecutionReadFailover(
    (connection) =>
      connection.simulateTransaction(tx, {
        sigVerify: false,
        commitment: "confirmed",
      }),
    signal,
  );

  if (signal?.aborted) {
    throw new SwapError("wallet_rejected", "Transaction cancelled");
  }

  if (response.value.err) {
    const logs = (response.value.logs ?? []).join("\n");
    const detail =
      typeof response.value.err === "string"
        ? response.value.err
        : JSON.stringify(response.value.err);
    throw mapSendError(new Error(`${detail}\n${logs}`));
  }
}

async function readSignatureStatus(
  signature: string,
  signal?: AbortSignal,
): Promise<{
  err: unknown;
  confirmationStatus: string | null;
} | null> {
  const result = await withExecutionReadFailover(
    (connection) =>
      connection.getSignatureStatuses([signature], {
        searchTransactionHistory: true,
      }),
    signal,
  );
  const status = result.value[0];
  if (!status) return null;
  return {
    err: status.err,
    confirmationStatus: status.confirmationStatus ?? null,
  };
}

async function isBlockhashExpired(
  flight: PendingSwapFlight,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const height = await withExecutionReadFailover(
      (connection) => connection.getBlockHeight("confirmed"),
      signal,
    );
    return height > flight.lastValidBlockHeight;
  } catch (error) {
    if (classifyExecutionRpcError(error, "read") === "retryable_infra") {
      return false;
    }
    throw error;
  }
}

function isConfirmedStatus(confirmationStatus: string | null): boolean {
  return (
    confirmationStatus === "confirmed" || confirmationStatus === "finalized"
  );
}

/**
 * Re-check a remembered flight before allowing another send.
 * Never reports success without confirmed/finalized status.
 */
export async function resolvePendingSwapFlight(
  signal?: AbortSignal,
): Promise<PendingFlightResolution> {
  const flight = getPendingSwapFlight();
  if (!flight) {
    return { status: "expired", message: SWAP_COPY.expired };
  }

  if (flight.signature) {
    try {
      const status = await readSignatureStatus(flight.signature, signal);
      if (status?.err) {
        clearPendingSwapFlight();
        return { status: "failed", message: SWAP_COPY.failure };
      }
      if (status && isConfirmedStatus(status.confirmationStatus)) {
        clearPendingSwapFlight();
        return { status: "confirmed", signature: flight.signature };
      }
    } catch (error) {
      if (classifyExecutionRpcError(error, "read") !== "retryable_infra") {
        throw mapSendError(error, flight.signature);
      }
      return {
        status: "pending",
        signature: flight.signature,
        message: SWAP_COPY.confirmationUnknown,
      };
    }
  }

  try {
    if (await isBlockhashExpired(flight, signal)) {
      if (flight.signature) {
        try {
          const late = await readSignatureStatus(flight.signature, signal);
          if (late?.err) {
            clearPendingSwapFlight();
            return { status: "failed", message: SWAP_COPY.failure };
          }
          if (late && isConfirmedStatus(late.confirmationStatus)) {
            clearPendingSwapFlight();
            return { status: "confirmed", signature: flight.signature };
          }
        } catch {
          /* still treat as expired if history read fails after expiry */
        }
      }
      clearPendingSwapFlight();
      return { status: "expired", message: SWAP_COPY.expired };
    }
  } catch {
    return {
      status: "pending",
      signature: flight.signature,
      message: SWAP_COPY.confirmationUnknown,
    };
  }

  return {
    status: "pending",
    signature: flight.signature,
    message: SWAP_COPY.confirmationUnknown,
  };
}

async function confirmSignature(options: {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  signal?: AbortSignal;
}): Promise<void> {
  if (options.signal?.aborted) {
    throwUnknownConfirmation(options.signature);
  }

  try {
    const result = await withExecutionReadFailover(
      (connection) =>
        connection.confirmTransaction(
          {
            signature: options.signature,
            blockhash: options.blockhash,
            lastValidBlockHeight: options.lastValidBlockHeight,
          },
          "confirmed",
        ),
      options.signal,
    );
    if (result.value.err) {
      clearPendingSwapFlight();
      throw new SwapError(
        "send_failed",
        "Transaction failed",
        result.value.err,
        options.signature,
      );
    }
    return;
  } catch (cause) {
    if (cause instanceof SwapError) throw cause;

    const raw = cause instanceof Error ? cause.message : String(cause ?? "");
    const expired = /block height exceeded|blockhash not found|expired/i.test(
      raw,
    );

    try {
      const status = await readSignatureStatus(options.signature, options.signal);
      if (status?.err) {
        clearPendingSwapFlight();
        throw new SwapError(
          "send_failed",
          "Transaction failed",
          status.err,
          options.signature,
        );
      }
      if (status && isConfirmedStatus(status.confirmationStatus)) {
        return;
      }
    } catch (statusError) {
      if (statusError instanceof SwapError) throw statusError;
      throwUnknownConfirmation(options.signature, statusError);
    }

    if (expired) {
      const late = await resolvePendingSwapFlight(options.signal);
      if (late.status === "confirmed") return;
      if (late.status === "failed") {
        throw new SwapError(
          "send_failed",
          "Transaction failed",
          cause,
          options.signature,
        );
      }
      if (late.status === "expired") {
        throw new SwapError(
          "stale_quote",
          "Transaction expired",
          cause,
          options.signature,
        );
      }
    }

    throwUnknownConfirmation(options.signature, cause);
  }
}

/**
 * Build → simulate (pre-approve) → Phantom approve → send → confirm.
 * Success is returned only after Solana confirmation — never after sign alone.
 * Simulation failure never opens Phantom and never broadcasts.
 */
export async function executeSwap(options: {
  quote: SwapQuote;
  wallet: ConnectedWallet;
  signal?: AbortSignal;
  /** When false, caller already holds the submit lock. */
  manageLock?: boolean;
  onPhase?: (phase: ExecutePhase, detail?: { signature?: string }) => void;
}): Promise<SwapExecutionResult> {
  assertCanExecuteSwaps();

  if (!isQuoteFresh(options.quote)) {
    throw new SwapError(
      "stale_quote",
      "Transaction expired",
    );
  }

  if (
    !options.wallet.signTransaction &&
    !options.wallet.signAndSendTransaction
  ) {
    throw new SwapError(
      "wallet_rejected",
      "This wallet cannot sign the transaction.",
    );
  }

  const existing = getPendingSwapFlight();
  if (existing) {
    const resolved = await resolvePendingSwapFlight(options.signal);
    if (resolved.status === "confirmed") {
      return { signature: resolved.signature, confirmed: true };
    }
    if (resolved.status === "pending") {
      throwUnknownConfirmation(resolved.signature);
    }
    // failed / expired: flight cleared — continue with a new swap.
  }

  const manageLock = options.manageLock !== false;
  const owner = flightOwner(options.quote, options.wallet);
  if (manageLock && !acquireSwapSubmitLock(owner)) {
    throw new SwapError("in_flight", "Transaction already in progress.");
  }

  try {
    await assertMainnetRpc(options.signal);

    if (!isQuoteFresh(options.quote)) {
      throw new SwapError("stale_quote", "Transaction expired");
    }

    const router = requireExecutionRouter();
    const built = await router.buildSwapTransaction({
      quote: options.quote,
      userPublicKey: options.wallet.publicKey,
      signal: options.signal,
    });

    const tx = decodeTransaction(built.transactionBase64);

    // Pre-approve gate: simulate before any Phantom prompt.
    await assertPreApproveSimulation(tx, options.signal);

    const latest = await withExecutionReadFailover(
      (connection) => connection.getLatestBlockhash("confirmed"),
      options.signal,
    );
    const blockhash = tx.message.recentBlockhash || latest.blockhash;
    const lastValidBlockHeight =
      built.lastValidBlockHeight ?? latest.lastValidBlockHeight;

    options.onPhase?.("wallet");

    let signature: string | null = null;

    // Prefer explicit sign → send so preflight stays under our control.
    if (options.wallet.signTransaction) {
      const signed = await options.wallet.signTransaction(tx);
      signature = signatureFromSignedTx(signed);

      rememberSwapFlight({
        signature,
        blockhash,
        lastValidBlockHeight,
        walletPublicKey: options.wallet.publicKey,
      });

      const serialized = signed.serialize();
      const sendResult = await sendRawTransactionSequential({
        serialized,
        expectedSignature: signature,
        signal: options.signal,
      });

      if (sendResult.status === "sent") {
        signature = sendResult.signature;
        updatePendingSwapSignature(signature);
      } else if (sendResult.status === "ambiguous") {
        if (!signature) {
          throwUnknownConfirmation(null, sendResult.cause);
        }
        updatePendingSwapSignature(signature);
        // Same signed tx is not sent again — confirm/status only.
      } else if (isAlreadyProcessedError(sendResult.cause) && signature) {
        updatePendingSwapSignature(signature);
      } else {
        clearPendingSwapFlight();
        throw mapSendError(sendResult.cause, signature);
      }
    } else if (options.wallet.signAndSendTransaction) {
      try {
        signature = await options.wallet.signAndSendTransaction(tx);
      } catch (cause) {
        rememberSwapFlight({
          signature: null,
          blockhash,
          lastValidBlockHeight,
          walletPublicKey: options.wallet.publicKey,
        });
        const mapped = mapSendError(cause);
        if (mapped.code === "wallet_rejected") {
          clearPendingSwapFlight();
          throw mapped;
        }
        throwUnknownConfirmation(null, cause);
      }
      if (!signature) {
        rememberSwapFlight({
          signature: null,
          blockhash,
          lastValidBlockHeight,
          walletPublicKey: options.wallet.publicKey,
        });
        throwUnknownConfirmation(null);
      }
      rememberSwapFlight({
        signature,
        blockhash,
        lastValidBlockHeight,
        walletPublicKey: options.wallet.publicKey,
      });
    } else {
      throw new SwapError(
        "wallet_rejected",
        "This wallet cannot sign the transaction.",
      );
    }

    if (!signature) {
      throwUnknownConfirmation(null);
    }

    // Signed + broadcast — not success yet.
    options.onPhase?.("submitted", { signature });
    options.onPhase?.("confirming", { signature });

    await confirmSignature({
      signature,
      blockhash,
      lastValidBlockHeight,
      signal: options.signal,
    });

    clearPendingSwapFlight();

    // Only after Solana confirmation — never after Phantom sign alone.
    return { signature, confirmed: true };
  } catch (cause) {
    throw mapSendError(cause);
  } finally {
    if (manageLock) releaseSwapSubmitLock(owner);
  }
}
