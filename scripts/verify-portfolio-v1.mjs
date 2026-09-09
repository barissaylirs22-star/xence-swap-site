/**
 * Offline Portfolio V1 checks. ZERO live network.
 * Usage: node scripts/verify-portfolio-v1.mjs
 */
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parsedRow(mint, amount, decimals) {
  return {
    account: {
      data: {
        parsed: {
          info: {
            mint,
            tokenAmount: { amount, decimals },
          },
        },
      },
    },
  };
}

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

try {
  console.log("=== Portfolio V1 (offline) ===\n");

  const parse = await server.ssrLoadModule("/src/lib/portfolio/parse.ts");
  const format = await server.ssrLoadModule("/src/lib/portfolio/format.ts");
  const session = await server.ssrLoadModule("/src/lib/portfolio/session.ts");
  const programs = await server.ssrLoadModule("/src/lib/portfolio/programs.ts");
  const catalog = await server.ssrLoadModule("/src/lib/tokens/catalog.ts");

  const { aggregateTokenAccounts, parseTokenAccountRow, toTokenDisplayRows } =
    parse;
  const { formatRawUnits } = format;
  const { createPortfolioLoadGate } = session;
  const { PORTFOLIO_RPC_METHODS } = programs;
  const { USDC_MINT, BONK_MINT } = catalog;

  const a = parsedRow(USDC_MINT, "1000000", 6);
  const b = parsedRow(USDC_MINT, "2500000", 6);
  const aggregated = aggregateTokenAccounts([a, b]);
  assert(aggregated.length === 1, "same mint collapses to one row");
  assert(aggregated[0].rawAmount === 3500000n, "raw amounts add as bigint");
  assert(aggregated[0].decimals === 6, "decimals preserved");
  const display = toTokenDisplayRows(aggregated);
  assert(display[0].uiAmount === "3.5", "1.0 + 2.5 USDC → 3.5");
  console.log("OK 1) duplicate token accounts for the same mint aggregate");

  const zeroed = aggregateTokenAccounts([
    parsedRow(USDC_MINT, "0", 6),
    parsedRow(BONK_MINT, "0", 5),
  ]);
  assert(zeroed.length === 0, "zero balances excluded");
  console.log("OK 2) zero balances excluded");

  const huge = "123456789012345678";
  const big = aggregateTokenAccounts([parsedRow(USDC_MINT, huge, 6)]);
  assert(big[0].rawAmount.toString() === huge, "large raw integer preserved");
  assert(
    formatRawUnits(huge, 6) === "123456789012.345678",
    "large raw formats without Number() loss",
  );
  console.log("OK 3) large raw integer precision preserved");

  const mixed = aggregateTokenAccounts([
    parsedRow(USDC_MINT, "1000000", 6),
    null,
    { account: { data: { parsed: { info: { mint: "nope" } } } } },
    parsedRow(USDC_MINT, "not-a-number", 6),
    parsedRow(USDC_MINT, "1", 1.5),
    parsedRow(BONK_MINT, "100", 5),
  ]);
  assert(parseTokenAccountRow(undefined) === null, "undefined row skipped");
  assert(
    mixed.length === 2 &&
      mixed.some((row) => row.mint === USDC_MINT) &&
      mixed.some((row) => row.mint === BONK_MINT),
    "malformed rows skipped; valid rows kept",
  );
  console.log("OK 4) malformed token accounts skipped fail-closed");

  const gate = createPortfolioLoadGate();
  const first = gate.start("wallet-a");
  const second = gate.start("wallet-b");
  assert(first.isCurrent() === false, "prior wallet load is stale");
  assert(second.isCurrent() === true, "latest wallet load is current");
  assert(first.signal?.aborted === true, "prior load aborted");
  assert(second.owner === "wallet-b", "gate tracks new owner");
  gate.abort();
  assert(second.isCurrent() === false, "abort invalidates in-flight load");
  console.log("OK 5) wallet change clears stale in-flight reads");

  assert(PORTFOLIO_RPC_METHODS.length === 3, "exactly three RPC methods per refresh");
  assert(
    PORTFOLIO_RPC_METHODS[0] === "getBalance",
    "native SOL uses getBalance",
  );
  assert(
    PORTFOLIO_RPC_METHODS.filter((m) => m === "getParsedTokenAccountsByOwner")
      .length === 2,
    "owner token query is two program-wide calls, not per mint",
  );

  const fetchSrc = readFileSync(
    resolve(root, "src/lib/portfolio/fetch.ts"),
    "utf8",
  );
  const hookSrc = readFileSync(resolve(root, "src/hooks/usePortfolio.ts"), "utf8");
  assert(
    !fetchSrc.includes("for (const mint") &&
      !fetchSrc.includes(".map(async") &&
      !fetchSrc.includes("for await"),
    "fetch has no per-token RPC loop",
  );
  assert(
    !hookSrc.includes("setInterval") &&
      !hookSrc.includes("setTimeout") &&
      !fetchSrc.includes("setInterval") &&
      !fetchSrc.includes("setTimeout"),
    "no polling timers in portfolio fetch/hook",
  );
  assert(
    (fetchSrc.match(/connection\.getParsedTokenAccountsByOwner/g) || []).length === 2,
    "only two getParsedTokenAccountsByOwner call sites",
  );
  console.log("OK 6) manual refresh path has no polling and no per-token RPC fan-out");

  console.log("\nAll Portfolio V1 checks passed.");
} finally {
  await server.close();
}
