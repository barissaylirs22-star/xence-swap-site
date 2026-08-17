import {
  Connection,
  VersionedTransaction,
} from "@solana/web3.js";
import { getPrimarySolanaRpcUrl } from "@/lib/solana/rpcEndpoints";
import type { ConnectedWallet } from "@/lib/wallet/types";
import { requireExecutionRouter } from "./createRouter";
import { SwapError } from "./errors";
import { assertCanExecuteSwaps } from "./gate";
import { assertMainnetRpc } from "./network";
import { isQuoteFresh } from "./quoteFreshness";
import {
  acquireSwapSubmitLock,
  releaseSwapSubmitLock,
} from "./submitLock";
import type { SwapExecutionResult, SwapQuote } from "./types";

export type ExecutePhase = "wallet" | "submitted" | "confirming";

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

function mapSendError(cause: unknown): SwapError {
  if (cause instanceof SwapError) return cause;
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  const lower = raw.toLowerCase();

  if (/reject|cancel|denied|user rejected/i.test(raw)) {
    return new SwapError("wallet_rejected", "Transaction cancelled", cause);
  }
  if (/blockhash not found|block height exceeded|expired/i.test(lower)) {
    return new SwapError("stale_quote", "Transaction expired", cause);
  }
  if (/slippage|0x1771|custom program error: 6001/i.test(lower)) {
    return new SwapError("slippage_exceeded", "Slippage exceeded", cause);
  }
  if (/simulation failed|insufficient funds|insufficient lamports/i.test(lower)) {
    return new SwapError(
      "simulation_failed",
      "Transaction failed",
      cause,
    );
  }
  if (/429|network|fetch|failed to fetch|timed out|timeout/i.test(lower)) {
    return new SwapError("network", "RPC/network error", cause);
  }
  return new SwapError("send_failed", "Transaction failed", cause);
}

/**
 * Fail-closed RPC simulation of the built (unsigned) transaction.
 * Must run before any wallet approval/signing request.
 */
async function assertPreApproveSimulation(
  connection: Connection,
  tx: VersionedTransaction,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new SwapError("wallet_rejected", "Transaction cancelled");
  }

  let response;
  try {
    response = await connection.simulateTransaction(tx, {
      sigVerify: false,
      commitment: "confirmed",
    });
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause ?? "");
    if (/429|network|fetch|failed to fetch|timed out|timeout/i.test(raw)) {
      throw new SwapError("network", "RPC/network error", cause);
    }
    throw new SwapError(
      "simulation_failed",
      "Transaction failed",
      cause,
    );
  }

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
    const connection = new Connection(getPrimarySolanaRpcUrl(), "confirmed");

    // Pre-approve gate: simulate before any Phantom prompt.
    await assertPreApproveSimulation(connection, tx, options.signal);

    options.onPhase?.("wallet");

    let signature: string;

    // Prefer explicit sign → send so preflight stays under our control.
    if (options.wallet.signTransaction) {
      const signed = await options.wallet.signTransaction(tx);
      try {
        signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
          preflightCommitment: "confirmed",
        });
      } catch (cause) {
        throw mapSendError(cause);
      }
    } else if (options.wallet.signAndSendTransaction) {
      try {
        signature = await options.wallet.signAndSendTransaction(tx);
      } catch (cause) {
        throw mapSendError(cause);
      }
      if (!signature) {
        throw new SwapError("send_failed", "Transaction failed");
      }
    } else {
      throw new SwapError(
        "wallet_rejected",
        "This wallet cannot sign the transaction.",
      );
    }

    // Signed + broadcast — not success yet.
    options.onPhase?.("submitted", { signature });
    options.onPhase?.("confirming", { signature });

    try {
      const recentBlockhash = tx.message.recentBlockhash;
      const latest = await connection.getLatestBlockhash("confirmed");
      const result = await connection.confirmTransaction(
        {
          signature,
          blockhash: recentBlockhash || latest.blockhash,
          lastValidBlockHeight:
            built.lastValidBlockHeight ?? latest.lastValidBlockHeight,
        },
        "confirmed",
      );
      if (result.value.err) {
        throw new SwapError(
          "send_failed",
          "Transaction failed",
          result.value.err,
        );
      }
    } catch (cause) {
      if (cause instanceof SwapError) throw cause;
      const raw = cause instanceof Error ? cause.message : String(cause ?? "");
      if (/block height exceeded|blockhash not found|expired/i.test(raw)) {
        throw new SwapError("stale_quote", "Transaction expired", cause);
      }
      throw new SwapError(
        "confirmation_timeout",
        "RPC/network error",
        cause,
      );
    }

    // Only after Solana confirmation — never after Phantom sign alone.
    return { signature, confirmed: true };
  } catch (cause) {
    throw mapSendError(cause);
  } finally {
    if (manageLock) releaseSwapSubmitLock(owner);
  }
}
