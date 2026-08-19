/**
 * Local readiness check for the production Cloudflare Worker modules.
 * Does NOT deploy. Does NOT call Helius. Does NOT require live Cloudflare credentials.
 *
 * Usage: npm run worker:check
 */
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const EXPECTED_KV_BINDING = "AXIOM_HOLDER_INTEL";
const EXPECTED_KV_ID = "6ba20b969a044399b00227fca8ec0401";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Minimal KV mock matching Workers KV get/put/delete used by the Worker. */
function createMockKv() {
  const data = new Map();
  return {
    async get(key, type) {
      const raw = data.get(key);
      if (raw == null) return null;
      if (type === "json") {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return raw;
    },
    async put(key, value) {
      data.set(key, typeof value === "string" ? value : JSON.stringify(value));
    },
    async delete(key) {
      data.delete(key);
    },
    _dump() {
      return data;
    },
  };
}

async function main() {
  console.log("=== Worker production readiness (local, no deploy) ===\n");

  const toml = readFileSync(resolve(root, "wrangler.toml"), "utf8");
  assert(toml.includes('name = "axiom-holders-api"'), "wrangler name missing");
  assert(toml.includes("workers/holders-rpc.js"), "wrangler main missing");
  assert(
    toml.includes("axiom-swap.xyz/api/solana-holders*"),
    "solana-holders route must end with * (query-string match)",
  );
  assert(
    toml.includes("axiom-swap.xyz/api/solana-rpc*"),
    "solana-rpc route must end with * (query-string match)",
  );
  assert(
    toml.includes("axiom-swap.xyz/api/holder-intel*"),
    "holder-intel route must end with * (query-string match)",
  );
  assert(
    toml.includes("axiom-swap.xyz/api/health*"),
    "health route must end with * (query-string match)",
  );
  // Exact routes without * miss ?mint=... (CF matches full URL incl. query).
  assert(
    !toml.includes('"axiom-swap.xyz/api/holder-intel"'),
    "holder-intel must not use exact route without trailing *",
  );
  assert(
    toml.includes(`binding = "${EXPECTED_KV_BINDING}"`),
    `KV binding must be ${EXPECTED_KV_BINDING}`,
  );
  assert(
    toml.includes(`id = "${EXPECTED_KV_ID}"`),
    `KV id must be ${EXPECTED_KV_ID}`,
  );
  assert(
    !toml.includes("REPLACE_WITH_HOLDER_INTEL_KV_NAMESPACE_ID"),
    "old KV placeholder must be removed",
  );
  assert(
    !toml.includes('binding = "HOLDER_INTEL"'),
    "legacy HOLDER_INTEL binding must not remain",
  );
  console.log(
    `wrangler.toml: routes + ${EXPECTED_KV_BINDING}=${EXPECTED_KV_ID} OK`,
  );

  const core = await import(
    pathToFileURL(resolve(root, "server/holderIntel/core.mjs")).href
  );
  const api = await import(
    pathToFileURL(resolve(root, "server/holderIntel/api.mjs")).href
  );
  assert(typeof core.isValidMint === "function", "core.isValidMint missing");
  assert(
    typeof api.createHolderIntelHandler === "function",
    "createHolderIntelHandler missing",
  );
  console.log("server/holderIntel shared modules: OK");

  const worker = await import(
    pathToFileURL(resolve(root, "workers/holders-rpc.js")).href
  );
  assert(worker.default && typeof worker.default.fetch === "function", "fetch");
  assert(typeof worker.safeErrorMessage === "function", "safeErrorMessage");
  const leaked = worker.safeErrorMessage(
    new Error(
      "fetch failed https://mainnet.helius-rpc.com/?api-key=SECRET1234abcd",
    ),
  );
  assert(!leaked.includes("SECRET1234abcd"), "must redact keys");
  assert(!leaked.includes("https://"), "must redact URLs");
  console.log("workers/holders-rpc.js module + secret redaction: OK");

  // Missing KV → 503
  const noKv = await worker.default.fetch(
    new Request(
      "https://axiom-swap.xyz/api/holder-intel?mint=H71v11cDZhr7CvtGtk3EE5v1iyeE8vCKGFH26buhpump",
    ),
    {},
  );
  assert(noKv.status === 503, "missing AXIOM_HOLDER_INTEL should 503");
  const noKvBody = await noKv.json();
  assert(
    String(noKvBody.error || "").includes(EXPECTED_KV_BINDING),
    "503 must name AXIOM_HOLDER_INTEL",
  );

  // Missing Helius → 503 (no key leak)
  const mint = "H71v11cDZhr7CvtGtk3EE5v1iyeE8vCKGFH26buhpump";
  const noHelius = await worker.default.fetch(
    new Request("https://axiom-swap.xyz/api/solana-holders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenSupply",
        params: [mint],
      }),
    }),
    { [EXPECTED_KV_BINDING]: createMockKv() },
  );
  assert(noHelius.status === 503, "missing Helius secret should 503");
  assert(
    !JSON.stringify(await noHelius.json()).includes("api-key="),
    "503 body must not include api-key",
  );

  // Health sees KV binding
  const kv = createMockKv();
  const health = await worker.default.fetch(
    new Request("https://axiom-swap.xyz/api/health"),
    { [EXPECTED_KV_BINDING]: kv },
  );
  assert(health.status === 200, "health should 200");
  const healthJson = await health.json();
  assert(healthJson.holderIntelKv === true, "health must see AXIOM_HOLDER_INTEL");
  assert(healthJson.holdersRpc === false, "no Helius in local stub");
  console.log("Worker sees AXIOM_HOLDER_INTEL binding: OK");

  // Write snapshot via /api/holder-intel then read back
  const post = await worker.default.fetch(
    new Request("https://axiom-swap.xyz/api/holder-intel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mint,
        observation: {
          holderCount: 242,
          topHolderPct: 12.5,
          top10HolderPct: 40.1,
        },
      }),
    }),
    { [EXPECTED_KV_BINDING]: kv },
  );
  assert(post.status === 200, "POST holder-intel should 200");
  const postJson = await post.json();
  assert(postJson.persisted === true, "first observation should persist");
  assert(
    postJson.intel?.growth?.building === true ||
      postJson.intel?.growth?.available === false,
    "insufficient history must stay building/unavailable (not fabricated)",
  );

  const get = await worker.default.fetch(
    new Request(
      `https://axiom-swap.xyz/api/holder-intel?mint=${encodeURIComponent(mint)}`,
    ),
    { [EXPECTED_KV_BINDING]: kv },
  );
  assert(get.status === 200, "GET holder-intel should 200");
  const getJson = await get.json();
  assert(Array.isArray(getJson.snapshots) && getJson.snapshots.length === 1, "KV readback");
  assert(getJson.snapshots[0].holderCount === 242, "snapshot holderCount");
  assert(
    Math.abs(getJson.snapshots[0].topHolderPct - 12.5) < 0.01,
    "snapshot topHolderPct",
  );
  assert(
    getJson.intel?.growth?.building === true ||
      getJson.intel?.growth?.available === false,
    "single snapshot must not invent 5m/1h/6h/24h deltas",
  );
  console.log("KV write/read via /api/holder-intel: OK (building history, not fabricated)");

  // Trailing slash + SPA must not own /api paths (Worker routes specific paths)
  const slash = await worker.default.fetch(
    new Request("https://axiom-swap.xyz/api/holder-intel/", {
      method: "GET",
    }),
    { [EXPECTED_KV_BINDING]: kv },
  );
  // normalizePath strips trailing slash → same handler
  assert(slash.status === 200 || slash.status === 400, "trailing slash still API");
  const spa = await worker.default.fetch(
    new Request("https://axiom-swap.xyz/some-spa-route"),
    { [EXPECTED_KV_BINDING]: kv },
  );
  assert(spa.status === 404, "non-api paths are not SPA-fallback in Worker");
  console.log("API routes take precedence over non-API paths: OK");

  // Frontend paths
  const holdersSrc = readFileSync(
    resolve(root, "src/lib/intelligence/holders.ts"),
    "utf8",
  );
  const historySrc = readFileSync(
    resolve(root, "src/lib/intelligence/holderHistory.ts"),
    "utf8",
  );
  const whaleSrc = readFileSync(
    resolve(root, "src/lib/intelligence/whaleActivity.ts"),
    "utf8",
  );
  assert(holdersSrc.includes('"/api/solana-holders"'), "holders relative path");
  assert(historySrc.includes('"/api/holder-intel"'), "holder-intel relative path");
  assert(whaleSrc.includes('"/api/solana-holders"'), "whale uses holders proxy");
  assert(
    readFileSync(resolve(root, "src/lib/solana/rpc.ts"), "utf8").includes(
      '"/api/solana-rpc"',
    ),
    "standard RPC proxy relative path",
  );
  assert(
    !holdersSrc.includes("http://127.0.0.1") &&
      !historySrc.includes("http://localhost") &&
      !whaleSrc.includes("http://127.0.0.1"),
    "no localhost API hosts in production client paths",
  );
  console.log("frontend relative /api paths: OK");

  // Local Vite file store still present (dev path intact)
  assert(
    readFileSync(resolve(root, "vite/holderIntelProxy.ts"), "utf8").includes(
      ".data/holder-intel",
    ),
    "local Vite file store path must remain",
  );
  console.log("local-dev file store path preserved: OK");

  console.log("\nREADY FOR MANUAL CLOUDFLARE CONFIGURATION (local checks passed)");
  console.log(
    "Remaining before deploy: npx wrangler secret put HELIUS_API_KEY → npx wrangler deploy → verify /api/health",
  );
}

main().catch((err) => {
  console.error("NOT READY —", err instanceof Error ? err.message : err);
  process.exit(1);
});
