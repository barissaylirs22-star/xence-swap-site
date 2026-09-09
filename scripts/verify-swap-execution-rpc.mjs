/**
 * Offline Swap execution-RPC failover checks. ZERO live network.
 * Usage: node scripts/verify-swap-execution-rpc.mjs
 */
import { createServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function statusError(status, text = "Forbidden") {
  const err = new Error(`${status} ${text}`);
  err.status = status;
  return err;
}

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

try {
  console.log("=== Swap execution RPC failover (403) ===\n");

  const rpc = await server.ssrLoadModule("/src/lib/solana/executionRpc.ts");
  const lock = await server.ssrLoadModule("/src/lib/swap/submitLock.ts");

  const {
    classifyExecutionRpcError,
    sendRawTransactionSequential,
    withExecutionReadFailover,
    httpStatusFromError,
  } = rpc;
  const {
    rememberSwapFlight,
    hasUnresolvedSwapFlight,
    isSwapResubmitBlocked,
    acquireSwapSubmitLock,
    releaseSwapSubmitLock,
    clearPendingSwapFlight,
  } = lock;

  clearPendingSwapFlight();
  releaseSwapSubmitLock();

  assert(httpStatusFromError(statusError(403)) === 403, "parse HTTP 403");
  assert(
    classifyExecutionRpcError(statusError(403), "read") === "retryable_infra",
    "403 read is retryable endpoint failure",
  );
  assert(
    classifyExecutionRpcError(statusError(403), "send") === "retryable_infra",
    "403 send is retryable (rejected before acceptance)",
  );
  assert(
    classifyExecutionRpcError(new Error("403 Forbidden"), "read") ===
      "retryable_infra",
    "403 from message text is retryable",
  );
  console.log("OK 1) HTTP 403 classified as retryable endpoint failure");

  assert(
    classifyExecutionRpcError(statusError(429), "send") === "retryable_infra",
    "429 send retryable",
  );
  assert(
    classifyExecutionRpcError(statusError(503), "send") === "ambiguous_send",
    "503 send is ambiguous — do not resend",
  );
  assert(
    classifyExecutionRpcError(new Error("fetch failed"), "send") ===
      "ambiguous_send",
    "network send is ambiguous",
  );
  assert(
    classifyExecutionRpcError(new Error("timed out"), "send") ===
      "ambiguous_send",
    "timeout send is ambiguous",
  );
  console.log("OK 2) 429 retryable; 5xx/timeout/network stay ambiguous on send");

  const deterministic = [
    new Error("Simulation failed"),
    new Error("Transaction simulation failed: Error"),
    Object.assign(new Error("preflight failure"), { code: -32002 }),
    new Error("Error: insufficient funds"),
    new Error("slippage exceeded 0x1771"),
    new Error("invalid transaction"),
    new Error("User rejected the request"),
    new Error("custom program error: 6001"),
  ];
  for (const err of deterministic) {
    assert(
      classifyExecutionRpcError(err, "read") === "deterministic",
      `read must not failover: ${err.message}`,
    );
    assert(
      classifyExecutionRpcError(err, "send") === "deterministic",
      `send must not failover: ${err.message}`,
    );
  }
  console.log("OK 3) deterministic tx/wallet errors do not failover");

  const bytesA = new Uint8Array([1, 2, 3, 4]);
  const endpoints = ["rpc-primary", "rpc-secondary"];
  const sendCalls = [];
  const result403 = await sendRawTransactionSequential({
    serialized: bytesA,
    expectedSignature: "Sig11111111111111111111111111111111111111111",
    endpoints,
    sendAt: async (endpoint, serialized) => {
      sendCalls.push({
        endpoint,
        sameBytes: serialized === bytesA,
        hex: Array.from(serialized).join(","),
      });
      if (endpoint === "rpc-primary") throw statusError(403);
      return "Sig11111111111111111111111111111111111111111";
    },
  });
  assert(result403.status === "sent", "403 then success");
  assert(sendCalls.length === 2, "sequential primary then secondary");
  assert(sendCalls[0].endpoint === "rpc-primary", "primary first");
  assert(sendCalls[1].endpoint === "rpc-secondary", "secondary second");
  assert(
    sendCalls.every((c) => c.sameBytes && c.hex === "1,2,3,4"),
    "exact same signed bytes on both endpoints",
  );
  console.log("OK 4) 403 send → sequential same-bytes fallback, no rebuild");

  const simOnce = [];
  const simOnceResult = await sendRawTransactionSequential({
    serialized: bytesA,
    expectedSignature: "Sig222",
    endpoints,
    sendAt: async (endpoint) => {
      simOnce.push(endpoint);
      throw new Error("Simulation failed: insufficient lamports");
    },
  });
  assert(simOnceResult.status === "failed", "deterministic failed");
  assert(simOnce.length === 1, "simulation error does not try next endpoint");
  assert(simOnce[0] === "rpc-primary", "stopped on primary");
  console.log("OK 5) deterministic simulation error → no endpoint fallback");

  const ambCalls = [];
  const amb = await sendRawTransactionSequential({
    serialized: bytesA,
    expectedSignature: "Sig333",
    endpoints,
    sendAt: async (endpoint) => {
      ambCalls.push(endpoint);
      throw statusError(503, "Service Unavailable");
    },
  });
  assert(amb.status === "ambiguous", "503 send is ambiguous");
  assert(ambCalls.length === 1, "ambiguous send does not hit second endpoint");
  console.log("OK 6) ambiguous 5xx broadcast → no second send");

  const netCalls = [];
  const net = await sendRawTransactionSequential({
    serialized: bytesA,
    expectedSignature: "Sig444",
    endpoints,
    sendAt: async (endpoint) => {
      netCalls.push(endpoint);
      throw new TypeError("Failed to fetch");
    },
  });
  assert(net.status === "ambiguous", "network send is ambiguous");
  assert(netCalls.length === 1, "network send does not duplicate broadcast");
  console.log("OK 7) ambiguous network send → no duplicate submission");

  const inFlight = [];
  let overlapping = false;
  await sendRawTransactionSequential({
    serialized: bytesA,
    expectedSignature: "Sig555",
    endpoints,
    sendAt: async (endpoint) => {
      if (inFlight.length > 0) overlapping = true;
      inFlight.push(endpoint);
      await Promise.resolve();
      inFlight.pop();
      if (endpoint === "rpc-primary") throw statusError(403);
      return "Sig555";
    },
  });
  assert(!overlapping, "never two in-flight sends (no race)");
  console.log("OK 8) no parallel RPC send");

  const readOrder = [];
  const readValue = await withExecutionReadFailover(
    async (connection) => connection.getGenesisHash(),
    undefined,
    {
      endpoints,
      connect: (endpoint) => {
        readOrder.push(endpoint);
        return {
          getGenesisHash: async () => {
            if (endpoint === "rpc-primary") throw statusError(403);
            return "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
          },
        };
      },
    },
  );
  assert(readValue.startsWith("5eykt4Us"), "read succeeded on fallback");
  assert(readOrder.join(">") === "rpc-primary>rpc-secondary", "sequential read");
  console.log("OK 9) 403 read/status → sequential fallback");

  const detRead = [];
  let detReadThrew = false;
  try {
    await withExecutionReadFailover(
      async (connection) => connection.simulateTransaction(),
      undefined,
      {
        endpoints,
        connect: (endpoint) => {
          detRead.push(endpoint);
          return {
            simulateTransaction: async () => {
              throw new Error("Simulation failed");
            },
          };
        },
      },
    );
  } catch {
    detReadThrew = true;
  }
  assert(detReadThrew, "deterministic sim throws");
  assert(detRead.length === 1, "sim failure does not fallback");
  console.log("OK 10) simulate program/sim error → no fallback");

  rememberSwapFlight({
    signature: "SigPending111",
    blockhash: "Hash111",
    lastValidBlockHeight: 1,
    walletPublicKey: "Wallet111",
  });
  assert(hasUnresolvedSwapFlight() === true, "flight remembered");
  assert(isSwapResubmitBlocked() === true, "resubmit blocked while pending");
  assert(acquireSwapSubmitLock("other") === true, "mutex can be separate");
  releaseSwapSubmitLock("other");
  assert(
    isSwapResubmitBlocked() === true,
    "flight still blocks after mutex release",
  );
  clearPendingSwapFlight();
  assert(isSwapResubmitBlocked() === false, "cleared flight allows resubmit");
  console.log("OK 11) unresolved-flight still blocks duplicate submit");

  console.log("\nverify-swap-execution-rpc: PASS");
  await server.close();
  process.exit(0);
} catch (err) {
  console.error("verify-swap-execution-rpc: FAIL");
  console.error(err);
  await server.close();
  process.exit(1);
}
