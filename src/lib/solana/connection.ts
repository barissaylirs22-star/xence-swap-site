import { Connection } from "@solana/web3.js";
import { getSolanaRpcEndpoints } from "./rpcEndpoints";

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; message?: string };
  return (
    err.name === "AbortError" ||
    `${err.message ?? ""}`.toLowerCase().includes("aborted")
  );
}

/**
 * Run a read against mainnet-beta, trying fallback RPCs on failure.
 * Does not sign or send transactions.
 */
export async function withMainnetRpc<T>(
  operation: (connection: Connection) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const endpoints = getSolanaRpcEndpoints();
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
      return await operation(connection);
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        throw error instanceof Error
          ? error
          : new DOMException("Aborted", "AbortError");
      }
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All Solana RPC endpoints failed");
}
