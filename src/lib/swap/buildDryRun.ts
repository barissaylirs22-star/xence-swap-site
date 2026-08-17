import { VersionedTransaction } from "@solana/web3.js";
import { canExecuteSwaps } from "./gate";
import type { BuiltSwapTransaction, SwapQuote } from "./types";

export interface BuildDryRunReport {
  /** Always false while executionEnabled is false — we do not bypass the gate. */
  attempted: boolean;
  built: boolean;
  gatedByExecutionFlag: boolean;
  transactionVersion: "legacy" | "versioned" | "unknown";
  hasPayload: boolean;
  inputMint: string | null;
  outputMint: string | null;
  amountRaw: string | null;
  walletPublicKey: string | null;
  routeSummary: string | null;
  lastValidBlockHeight: number | null;
  notes: string[];
}

/**
 * Pre-execution audit helper.
 * Does NOT call Jupiter /swap and does NOT bypass SWAP_FEATURES.executionEnabled.
 */
export function assessBuildDryRun(options: {
  quote: SwapQuote | null;
  walletPublicKey: string | null;
}): BuildDryRunReport {
  const quote = options.quote;
  const notes: string[] = [];

  if (!canExecuteSwaps()) {
    notes.push(
      "Transaction build is hard-gated by SWAP_FEATURES.executionEnabled=false.",
    );
    notes.push(
      "JupiterSwapRouter.buildSwapTransaction → assertCanExecuteSwaps() refuses the call.",
    );
    notes.push(
      "Dry-run does not bypass that gate; no /swap payload is requested.",
    );
  }

  if (!quote) {
    notes.push("No active quote available for a build.");
  }

  if (!options.walletPublicKey) {
    notes.push("Wallet public key required for a future build.");
  }

  return {
    attempted: false,
    built: false,
    gatedByExecutionFlag: !canExecuteSwaps(),
    transactionVersion: "versioned",
    hasPayload: false,
    inputMint: quote?.inputMint ?? null,
    outputMint: quote?.outputMint ?? null,
    amountRaw: quote?.inAmountRaw ?? null,
    walletPublicKey: options.walletPublicKey,
    routeSummary: quote?.routeSummary ?? null,
    lastValidBlockHeight: null,
    notes,
  };
}

/** Inspect a built base64 tx without signing/sending (future use when execution is on). */
export function inspectBuiltTransaction(
  built: BuiltSwapTransaction,
): Pick<BuildDryRunReport, "transactionVersion" | "hasPayload" | "lastValidBlockHeight"> {
  try {
    const binary = atob(built.transactionBase64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    VersionedTransaction.deserialize(bytes);
    return {
      transactionVersion: "versioned",
      hasPayload: true,
      lastValidBlockHeight: built.lastValidBlockHeight ?? null,
    };
  } catch {
    return {
      transactionVersion: "unknown",
      hasPayload: false,
      lastValidBlockHeight: built.lastValidBlockHeight ?? null,
    };
  }
}
