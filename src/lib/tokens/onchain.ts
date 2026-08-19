import { Connection, PublicKey } from "@solana/web3.js";
import { looksLikeMintAddress, shortMint } from "./catalog";
import type { TokenAsset } from "./types";

/** Same-origin standard RPC proxy — Provider B stays server-side. */
const SOLANA_RPC_PROXY = "/api/solana-rpc";

/** Resolve minimal metadata from chain when discovery APIs have no hit. */
export async function resolveMintOnChain(
  mint: string,
  signal?: AbortSignal,
): Promise<TokenAsset | null> {
  const trimmed = mint.trim();
  if (!looksLikeMintAddress(trimmed)) return null;

  try {
    const connection = new Connection(SOLANA_RPC_PROXY, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
    const pubkey = new PublicKey(trimmed);
    const account = await connection.getParsedAccountInfo(pubkey, "confirmed");
    if (signal?.aborted) return null;

    const info = account.value?.data;
    if (!info || typeof info === "string" || info instanceof Uint8Array) {
      return null;
    }

    const parsed = info.parsed as {
      type?: string;
      info?: { decimals?: number };
    };

    if (parsed.type !== "mint" || typeof parsed.info?.decimals !== "number") {
      return null;
    }

    return {
      mint: trimmed,
      symbol: shortMint(trimmed),
      name: "Unknown token",
      decimals: parsed.info.decimals,
      verified: false,
      selectable: true,
      warnings: ["unknown_metadata", "unverified"],
      iconUrl: null,
    };
  } catch {
    // Invalid base58 / RPC / non-mint account — fail closed.
    return null;
  }
}
