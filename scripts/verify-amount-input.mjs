/**
 * Offline pay-amount input sanitization checks. ZERO live network.
 * Usage: node scripts/verify-amount-input.mjs
 */
import { createServer } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

try {
  console.log("=== Swap pay-amount input sanitization ===\n");

  const spendable = await server.ssrLoadModule("/src/lib/swap/spendable.ts");
  const amounts = await server.ssrLoadModule("/src/lib/swap/amounts.ts");
  const catalog = await server.ssrLoadModule("/src/lib/tokens/catalog.ts");

  const {
    sanitizeAmountInput,
    isValidAmountShape,
    isIncompleteAmountDraft,
    validatePayAmount,
  } = spendable;
  const { toRawAmount, isPositiveAmount } = amounts;
  const { SOL_TOKEN } = catalog;

  assert(sanitizeAmountInput("0.01") === "0.01", "keep 0.01");
  assert(sanitizeAmountInput("0.001") === "0.001", "keep 0.001");
  assert(sanitizeAmountInput("1.25") === "1.25", "keep 1.25");
  console.log("OK 1) canonical decimals 0.01 / 0.001 / 1.25");

  assert(sanitizeAmountInput("0,01") === "0.01", "comma 0,01 → 0.01");
  assert(sanitizeAmountInput("0,01") !== "001", "comma must not collapse to 001");
  assert(Number(sanitizeAmountInput("0,01")) === 0.01, "0,01 numeric is 0.01");
  assert(Number(sanitizeAmountInput("0,01")) !== 1, "0,01 must not become 1 SOL");
  console.log("OK 2) locale comma 0,01 → 0.01 (not 001 / 1)");

  assert(sanitizeAmountInput("") === "", "empty");
  assert(sanitizeAmountInput("0") === "0", "bare 0");
  assert(sanitizeAmountInput("0.") === "0.", "keep trailing draft 0.");
  assert(sanitizeAmountInput("0.0") === "0.0", "keep 0.0");
  assert(isIncompleteAmountDraft("0.") === true, "0. is incomplete draft");
  assert(isIncompleteAmountDraft("0.0") === false, "0.0 is complete");
  assert(isPositiveAmount("0.") === false, "0. is not a positive amount");
  assert(toRawAmount("0.", 9) === null, "0. does not convert to raw");
  console.log("OK 3) intermediate drafts \"\" / 0 / 0. / 0.0");

  assert(sanitizeAmountInput("0.0.1") === "0.01", "extra dots dropped after first");
  assert(
    sanitizeAmountInput("0.0.1").includes("..") === false,
    "sanitized value has at most one dot",
  );
  assert(isValidAmountShape("0.0.1") === false, "unsanitized 0.0.1 is invalid");
  console.log("OK 4) reject/collapse multiple separators 0.0.1");

  assert(sanitizeAmountInput("0.01abc") === "0.01", "strip trailing junk");
  assert(Number(sanitizeAmountInput("0.01abc")) === 0.01, "junk does not change 0.01");
  assert(sanitizeAmountInput("abc") === "", "letters-only → empty");
  assert(sanitizeAmountInput("$0.01") === "0.01", "leading junk around 0.01");
  assert(Number(sanitizeAmountInput("0.01!")) === 0.01, "punctuation does not change 0.01");
  console.log("OK 5) invalid characters do not change 0.01");

  const draft = validatePayAmount({
    amount: "0.",
    token: SOL_TOKEN,
    balanceUi: 1,
    walletConnected: true,
  });
  assert(draft.ok === false && draft.issue === "empty", "0. is not quoted yet");

  const parsed = validatePayAmount({
    amount: sanitizeAmountInput("0,01"),
    token: SOL_TOKEN,
    balanceUi: 1,
    walletConnected: true,
  });
  assert(parsed.ok === true && parsed.amount === 0.01, "normalized 0,01 validates as 0.01");

  const tooBig = validatePayAmount({
    amount: sanitizeAmountInput("0,01"),
    token: SOL_TOKEN,
    balanceUi: 0.005,
    walletConnected: true,
  });
  assert(
    tooBig.ok === false && tooBig.issue === "insufficient",
    "0.01 vs 0.005 SOL still uses existing balance validation",
  );
  console.log("OK 6) conversion only after normalize; balance/reserve rules intact");

  console.log("\nAll amount-input checks passed.");
} finally {
  await server.close();
}
