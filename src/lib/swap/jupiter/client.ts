import {
  JUPITER_API_BASE,
  JUPITER_CLIENT_API_KEY,
  JUPITER_LITE_API_BASE,
  JUPITER_QUOTE_PATH,
  JUPITER_SWAP_PATH,
  SWAP_PROXY_URL,
} from "@/config/providers";
import { SwapError } from "@/lib/swap/errors";

function swapApiBase(): string {
  if (SWAP_PROXY_URL) return SWAP_PROXY_URL.replace(/\/$/, "");
  if (JUPITER_CLIENT_API_KEY) return JUPITER_API_BASE;
  return JUPITER_LITE_API_BASE;
}

function swapHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (JUPITER_CLIENT_API_KEY && !SWAP_PROXY_URL) {
    headers["x-api-key"] = JUPITER_CLIENT_API_KEY;
  }
  return headers;
}

export async function jupiterGetQuote(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${swapApiBase()}${JUPITER_QUOTE_PATH}?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: swapHeaders() });
  } catch (cause) {
    throw new SwapError("network", "Quote unavailable right now.", cause);
  }

  if (!res.ok) {
    throw new SwapError("quote_unavailable", "Quote unavailable right now.");
  }

  try {
    return await res.json();
  } catch (cause) {
    throw new SwapError("quote_unavailable", "Quote unavailable right now.", cause);
  }
}

export async function jupiterBuildSwap(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const url = `${swapApiBase()}${JUPITER_SWAP_PATH}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        ...swapHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new SwapError("network", "Could not prepare the swap.", cause);
  }

  if (!res.ok) {
    throw new SwapError("build_failed", "Could not prepare the swap.");
  }

  try {
    return await res.json();
  } catch (cause) {
    throw new SwapError("build_failed", "Could not prepare the swap.", cause);
  }
}
