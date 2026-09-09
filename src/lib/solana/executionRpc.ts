import {
  Connection,
  SendTransactionError,
  type VersionedTransaction,
} from "@solana/web3.js";
import { getSolanaRpcEndpoints } from "./rpcEndpoints";

/**
 * Client-side Swap execution RPC helpers.
 * Sequential failover only — never races endpoints, never logs URLs/keys.
 *
 * Qualifying endpoint/infra failures:
 * network, timeout, HTTP 403, HTTP 429, HTTP 5xx, RPC -32005.
 * HTTP 403 is a rejected request (common on public RPCs that block browser Origins).
 */

export type ExecutionRpcKind =
  | "retryable_infra"
  | "ambiguous_send"
  | "deterministic";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function encodeSignatureBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const size = (((bytes.length - zeros) * 138) / 100 + 1) | 0;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i] ?? 0;
    let j = 0;
    for (let k = size - 1; carry !== 0 || j < length; k -= 1, j += 1) {
      carry += 256 * (b58[k] ?? 0);
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let it = size - length;
  while (it < size && b58[it] === 0) it += 1;
  let str = "1".repeat(zeros);
  for (; it < size; it += 1) {
    str += BASE58_ALPHABET[b58[it] ?? 0] ?? "";
  }
  return str;
}

export function signatureFromSignedTx(
  tx: VersionedTransaction,
): string | null {
  const sig = tx.signatures[0];
  if (!sig || sig.length === 0) return null;
  if (sig.every((b) => b === 0)) return null;
  return encodeSignatureBytes(sig);
}

export function createExecutionConnection(endpoint: string): Connection {
  return new Connection(endpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
  });
}

export function listExecutionRpcEndpoints(): string[] {
  return getSolanaRpcEndpoints();
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`;
  return String(error ?? "");
}

export function httpStatusFromError(error: unknown): number | null {
  if (error && typeof error === "object") {
    const rec = error as { statusCode?: unknown; status?: unknown };
    if (typeof rec.statusCode === "number") return rec.statusCode;
    if (typeof rec.status === "number") return rec.status;
  }
  const text = errorText(error);
  const match = text.match(/\b(403|429|5\d\d)\b/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function jsonRpcCode(error: unknown): number | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") return code;
  }
  return null;
}

export function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; message?: string };
  return (
    err.name === "AbortError" ||
    `${err.message ?? ""}`.toLowerCase().includes("aborted")
  );
}

function isTimeoutError(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  if (isAbortLike(error) && /timeout|timed out/.test(text)) return true;
  return /timed out|timeout|etimedout|esockettimedout/.test(text);
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const text = errorText(error).toLowerCase();
  return (
    /failed to fetch|networkerror|network request failed|econnreset|econnrefused|enotfound|fetch failed|load failed/.test(
      text,
    ) && !/\b(403|429|5\d\d)\b/.test(text)
  );
}

function isDeterministicTxError(error: unknown): boolean {
  if (error instanceof SendTransactionError) return true;
  const text = errorText(error).toLowerCase();
  const code = jsonRpcCode(error);
  if (
    code === -32002 ||
    code === -32003 ||
    code === -32006 ||
    code === -32013
  ) {
    return true;
  }
  return (
    /simulation failed|preflight|insufficient funds|insufficient lamports|slippage|0x1771|custom program error|invalid transaction|transaction signature verification|blockhash not found|block height exceeded|already been processed|already processed|duplicate instruction|0x1$/.test(
      text,
    ) || /reject|cancel|denied|user rejected/.test(text)
  );
}

export function isAlreadyProcessedError(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return /already been processed|already processed|duplicate signature/.test(
    text,
  );
}

/**
 * Classify an RPC/web3 error for Swap execution failover.
 * `op: "send"`: 403/429 are rejected before acceptance (same bytes may
 * go to the next endpoint). 5xx/timeout/network are ambiguous (do not resend).
 */
export function classifyExecutionRpcError(
  error: unknown,
  op: "read" | "send",
): ExecutionRpcKind {
  if (isAbortLike(error) && !isTimeoutError(error)) {
    return "deterministic";
  }
  if (isAlreadyProcessedError(error)) {
    return "deterministic";
  }

  const status = httpStatusFromError(error);
  const timeout = isTimeoutError(error);
  const network = isNetworkError(error);
  const nodeUnhealthy = jsonRpcCode(error) === -32005;
  const httpInfra =
    status === 403 ||
    status === 429 ||
    (status != null && status >= 500);

  // HTTP-level failures win over message regex (403 bodies are often HTML).
  if (httpInfra || timeout || network || nodeUnhealthy) {
    if (op === "send") {
      if (status === 403 || status === 429) return "retryable_infra";
      return "ambiguous_send";
    }
    return "retryable_infra";
  }

  if (isDeterministicTxError(error)) {
    return "deterministic";
  }
  return "deterministic";
}

export async function withExecutionReadFailover<T>(
  operation: (connection: Connection) => Promise<T>,
  signal?: AbortSignal,
  hooks?: {
    endpoints?: string[];
    connect?: (endpoint: string) => Connection;
  },
): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const endpoints = hooks?.endpoints ?? listExecutionRpcEndpoints();
  const connect =
    hooks?.connect ??
    ((endpoint: string) => createExecutionConnection(endpoint));
  let lastError: unknown;

  for (const endpoint of endpoints) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      const connection = connect(endpoint);
      return await operation(connection);
    } catch (error) {
      if (signal?.aborted || isAbortLike(error)) {
        throw error instanceof Error
          ? error
          : new DOMException("Aborted", "AbortError");
      }
      lastError = error;
      if (classifyExecutionRpcError(error, "read") !== "retryable_infra") {
        throw error;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All Solana RPC endpoints failed");
}

export type SequentialSendResult =
  | { status: "sent"; signature: string }
  | { status: "ambiguous"; cause: unknown }
  | { status: "failed"; cause: unknown };

/**
 * Send a signed transaction to one endpoint at a time.
 * Never broadcasts in parallel. Stops sending after an ambiguous result.
 * HTTP 403/429: sequential retry of the SAME signed bytes on the next endpoint.
 */
export async function sendRawTransactionSequential(options: {
  serialized: Uint8Array;
  expectedSignature: string | null;
  signal?: AbortSignal;
  /** Test seam — defaults to configured RPC list. Never log these. */
  endpoints?: string[];
  sendAt?: (endpoint: string, serialized: Uint8Array) => Promise<string>;
}): Promise<SequentialSendResult> {
  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const endpoints = options.endpoints ?? listExecutionRpcEndpoints();
  const sendAt =
    options.sendAt ??
    (async (ep: string, bytes: Uint8Array) => {
      const connection = createExecutionConnection(ep);
      return connection.sendRawTransaction(bytes, {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });
    });
  let lastRetryable: unknown;

  for (const endpoint of endpoints) {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const signature = await sendAt(endpoint, options.serialized);
      return { status: "sent", signature };
    } catch (error) {
      if (options.signal?.aborted || isAbortLike(error)) {
        throw error instanceof Error
          ? error
          : new DOMException("Aborted", "AbortError");
      }

      if (
        isAlreadyProcessedError(error) &&
        options.expectedSignature
      ) {
        return { status: "sent", signature: options.expectedSignature };
      }

      const kind = classifyExecutionRpcError(error, "send");
      if (kind === "ambiguous_send") {
        return { status: "ambiguous", cause: error };
      }
      if (kind === "deterministic") {
        return { status: "failed", cause: error };
      }

      lastRetryable = error;
    }
  }

  return {
    status: "failed",
    cause: lastRetryable ?? new Error("All Solana RPC endpoints failed"),
  };
}
