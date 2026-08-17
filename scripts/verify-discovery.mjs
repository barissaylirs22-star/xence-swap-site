/**
 * Verify discovery universe loads 50+ real Solana tokens (no path aliases).
 */
const BASE = "https://api.dexscreener.com";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return res.json();
}

function looksLikeMint(m) {
  return typeof m === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m);
}

const [top, profiles, boosts, s1, s2, s3] = await Promise.all([
  fetchJson(`${BASE}/token-boosts/top/v1`),
  fetchJson(`${BASE}/token-profiles/latest/v1`),
  fetchJson(`${BASE}/token-boosts/latest/v1`),
  fetchJson(`${BASE}/latest/dex/search?q=SOL`),
  fetchJson(`${BASE}/latest/dex/search?q=pump`),
  fetchJson(`${BASE}/latest/dex/search?q=raydium`),
]);

const seeds = [];
const seen = new Set();
function push(mint, icon) {
  if (!looksLikeMint(mint) || seen.has(mint)) return;
  seen.add(mint);
  seeds.push({ mint, icon });
}

for (const x of [...(top || []), ...(profiles || []), ...(boosts || [])]) {
  if (x.chainId === "solana") push(x.tokenAddress, x.icon);
}
for (const data of [s1, s2, s3]) {
  for (const p of data?.pairs || []) {
    if (p.chainId === "solana") push(p.baseToken?.address, p.info?.imageUrl);
  }
}

const capped = seeds.slice(0, 60);
const tokens = [];
for (let i = 0; i < capped.length; i += 30) {
  const chunk = capped.slice(i, i + 30);
  const data = await fetchJson(
    `${BASE}/latest/dex/tokens/${chunk.map((s) => s.mint).join(",")}`,
  );
  const best = new Map();
  for (const pair of data?.pairs || []) {
    if (pair.chainId !== "solana") continue;
    const mint = pair.baseToken?.address;
    if (!mint) continue;
    const prev = best.get(mint);
    if (!prev || (pair.volume?.h24 || 0) > (prev.volume?.h24 || 0)) {
      best.set(mint, pair);
    }
  }
  for (const seed of chunk) {
    const pair = best.get(seed.mint);
    tokens.push({
      mint: seed.mint,
      symbol: pair?.baseToken?.symbol || seed.mint.slice(0, 4),
      name: pair?.baseToken?.name || "Unknown",
      volume24hUsd: pair?.volume?.h24 ?? null,
      liquidityUsd: pair?.liquidity?.usd ?? null,
      priceUsd: pair?.priceUsd ? Number(pair.priceUsd) : null,
      listedAt: pair?.pairCreatedAt ?? null,
    });
  }
}

if (tokens.length < 50) {
  console.error("FAIL: expected >=50 tokens, got", tokens.length);
  process.exit(1);
}

const withVol = tokens.filter((t) => t.volume24hUsd != null);
const sample = tokens.slice(0, 10).map((t) => t.symbol);

console.log(`OK — ${tokens.length} real enriched Solana tokens`);
console.log(`With 24h volume: ${withVol.length}`);
console.log(`Sample: ${sample.join(", ")}`);
console.log(
  "Top by volume:",
  [...withVol]
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, 5)
    .map((t) => `${t.symbol}=$${Math.round(t.volume24hUsd).toLocaleString()}`)
    .join(", "),
);
