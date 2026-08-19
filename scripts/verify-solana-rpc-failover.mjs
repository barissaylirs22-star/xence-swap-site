/**
 * Local unit verification for standard Solana RPC failover.
 * Usage: node scripts/verify-solana-rpc-failover.mjs
 */
import {
  forwardStandardRpcWithFailover,
  isQualifyingFailover,
  STANDARD_RPC_ALLOWED_METHODS,
} from "../server/solanaRpcFailover.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function mockFetchSequence(responses) {
  let i = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body });
    const next = responses[i++];
    if (!next) throw new Error("Unexpected extra fetch");
    if (next.throwNetwork) throw new TypeError("fetch failed");
    if (next.throwTimeout) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    return { status: next.status, text: async () => next.text };
  };
  return { fetchImpl, calls };
}

async function main() {
  console.log("=== Standard RPC failover unit checks ===\n");

  assert(STANDARD_RPC_ALLOWED_METHODS.has("getAccountInfo"), "allow getAccountInfo");
  assert(STANDARD_RPC_ALLOWED_METHODS.has("getTokenSupply"), "allow getTokenSupply");
  assert(
    !STANDARD_RPC_ALLOWED_METHODS.has("getTokenAccounts"),
    "DAS getTokenAccounts must NOT be allowed",
  );
  assert(
    !STANDARD_RPC_ALLOWED_METHODS.has("sendTransaction"),
    "sendTransaction must NOT be allowed",
  );

  assert(isQualifyingFailover(503), "5xx qualifies");
  assert(isQualifyingFailover(429), "429 qualifies");
  assert(isQualifyingFailover(null, { network: true }), "network qualifies");
  assert(isQualifyingFailover(null, { timeout: true }), "timeout qualifies");
  assert(!isQualifyingFailover(200), "200 does not qualify");
  assert(!isQualifyingFailover(400), "400 does not qualify");
  assert(!isQualifyingFailover(403), "403 does not qualify");

  {
    const { fetchImpl, calls } = mockFetchSequence([
      {
        status: 200,
        text: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok-primary" }),
      },
    ]);
    const result = await forwardStandardRpcWithFailover({
      body: "{}",
      primaryUrl: "https://primary.example/rpc",
      fallbackUrl: "https://fallback.example/rpc",
      fetchImpl,
    });
    assert(result.used === "primary", "healthy uses primary");
    assert(result.fallbackAttempted === false, "no fallback attempt");
    assert(calls.length === 1, "exactly one upstream call");
    assert(calls[0].url === "https://primary.example/rpc", "only primary URL");
    console.log("OK 1) healthy primary → ZERO Provider B calls");
  }

  {
    const { fetchImpl, calls } = mockFetchSequence([
      { status: 503, text: "unavailable" },
      {
        status: 200,
        text: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok-fallback" }),
      },
    ]);
    const result = await forwardStandardRpcWithFailover({
      body: '{"method":"getTokenSupply"}',
      primaryUrl: "https://primary.example/rpc",
      fallbackUrl: "https://fallback.example/rpc",
      fetchImpl,
    });
    assert(result.used === "fallback", "uses fallback after 503");
    assert(result.fallbackAttempted === true, "fallback attempted");
    assert(calls.length === 2, "primary then fallback once");
    assert(calls[1].url === "https://fallback.example/rpc", "second is fallback");
    console.log("OK 2) primary 503 → Provider B once");
  }

  {
    const { fetchImpl, calls } = mockFetchSequence([
      { throwNetwork: true },
      { throwNetwork: true },
    ]);
    const result = await forwardStandardRpcWithFailover({
      body: "{}",
      primaryUrl: "https://primary.example/rpc",
      fallbackUrl: "https://fallback.example/rpc",
      fetchImpl,
    });
    assert(result.status === 502, "both down → 502");
    assert(calls.length === 2, "exactly two attempts");
    console.log("OK 3) both unavailable → clean failure, no retry storm");
  }

  {
    const { fetchImpl, calls } = mockFetchSequence([
      {
        status: 200,
        text: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32602, message: "Invalid param" },
        }),
      },
    ]);
    const result = await forwardStandardRpcWithFailover({
      body: "{}",
      primaryUrl: "https://primary.example/rpc",
      fallbackUrl: "https://fallback.example/rpc",
      fetchImpl,
    });
    assert(result.used === "primary", "business error stays on primary");
    assert(result.fallbackAttempted === false, "no failover on JSON-RPC error");
    assert(calls.length === 1, "ZERO Provider B calls");
    console.log("OK 4) non-qualifying JSON-RPC error → ZERO Provider B");
  }

  {
    const { fetchImpl, calls } = mockFetchSequence([
      { status: 400, text: "bad request" },
    ]);
    const result = await forwardStandardRpcWithFailover({
      body: "{}",
      primaryUrl: "https://primary.example/rpc",
      fallbackUrl: "https://fallback.example/rpc",
      fetchImpl,
    });
    assert(result.used === "primary", "400 stays on primary");
    assert(calls.length === 1, "ZERO Provider B on 400");
    console.log("OK 4b) HTTP 400 → ZERO Provider B");
  }

  console.log("\nAll failover unit checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
