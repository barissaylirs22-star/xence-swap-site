import { Connection } from "@solana/web3.js";
import {
  getPrimarySolanaRpcUrl,
  getSolanaRpcEndpoints,
} from "@/lib/solana/rpcEndpoints";
import { SwapError } from "./errors";

/**
 * Solana mainnet-beta genesis hash (full base58).
 * Previously truncated — that caused every valid mainnet RPC to fail readiness.
 */
export const MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" as const;

const isDev = import.meta.env.DEV;

function diag(...args: unknown[]) {
  if (isDev) {
    // Development-only — never log secrets.
    console.info("[axiom:network]", ...args);
  }
}

/**
 * Confirm configured RPC endpoints resolve to Solana mainnet-beta.
 * Tries each endpoint; succeeds if any returns the mainnet genesis hash.
 * Read-only — never signs or sends.
 */
export async function assertMainnetRpc(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const endpoints = getSolanaRpcEndpoints();
  diag("rpc.endpoints", endpoints);
  diag("rpc.primary", getPrimarySolanaRpcUrl());
  diag("rpc.expectedGenesis", MAINNET_GENESIS_HASH);

  let sawMismatch = false;
  let lastError: unknown;

  for (const endpoint of endpoints) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const connection = new Connection(endpoint, {
        commitment: "confirmed",
        disableRetryOnRateLimit: true,
      });
      const genesis = await connection.getGenesisHash();
      const match = genesis === MAINNET_GENESIS_HASH;
      diag("rpc.genesis", { endpoint, genesis, match });

      if (match) {
        diag("rpc.mainnetVerified", true);
        return;
      }

      sawMismatch = true;
    } catch (error) {
      diag("rpc.endpointFailed", {
        endpoint,
        error: error instanceof Error ? error.message : "unknown",
      });
      lastError = error;
    }
  }

  if (sawMismatch) {
    diag("rpc.mainnetVerified", false, "genesis mismatch on all reachable RPCs");
    throw new SwapError(
      "wrong_network",
      "Connect to Solana mainnet to continue.",
    );
  }

  diag("rpc.mainnetVerified", false, "all RPC endpoints unavailable");
  throw new SwapError(
    "network",
    "Network unavailable. Please try again.",
    lastError,
  );
}
