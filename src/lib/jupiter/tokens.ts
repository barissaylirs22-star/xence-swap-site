import { getActiveMint, isLaunchLive } from "@/config/launch";
import { MARKET_PROXY_URL } from "@/config/providers";
import type { AxmMarketSnapshot } from "@/types/market";

/** Post-launch Tokens API via proxy. No-op before launch. */
export async function fetchLiveTokenStats(
  signal?: AbortSignal,
): Promise<Partial<AxmMarketSnapshot> | null> {
  if (!isLaunchLive() || !MARKET_PROXY_URL) return null;

  const mint = getActiveMint();
  if (!mint) return null;

  const url = new URL("/axm", MARKET_PROXY_URL);
  url.searchParams.set("mint", mint);

  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Market proxy error (${res.status})`);
  }

  return (await res.json()) as Partial<AxmMarketSnapshot>;
}
