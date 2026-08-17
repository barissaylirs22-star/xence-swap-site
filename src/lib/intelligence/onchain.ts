import { getCached, setCached } from "@/lib/market/cache";
import { withMainnetRpc } from "@/lib/solana/connection";
import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import { PublicKey } from "@solana/web3.js";
import { ONCHAIN_STALE_MS } from "@/config/providers";

export interface MintSecuritySnapshot {
  decimals: number | null;
  supplyUi: number | null;
  supplyRaw: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  mintAuthorityActive: boolean;
  freezeAuthorityActive: boolean;
  updatedAt: number;
}

function cacheKey(mint: string): string {
  return `intel:mint:${mint}`;
}

/**
 * Mint account + supply via mainnet RPC (with endpoint fallback).
 * Cached — reusable across intelligence loads.
 */
export async function fetchMintSecuritySnapshot(
  mint: string,
  signal?: AbortSignal,
): Promise<MintSecuritySnapshot | null> {
  const trimmed = mint.trim();
  if (!looksLikeMintAddress(trimmed)) return null;

  const cached = getCached<MintSecuritySnapshot>(cacheKey(trimmed));
  if (cached) return cached;

  try {
    const snapshot = await withMainnetRpc(async (connection) => {
      const pubkey = new PublicKey(trimmed);
      const [supply, account] = await Promise.all([
        connection.getTokenSupply(pubkey, "confirmed"),
        connection.getParsedAccountInfo(pubkey, "confirmed"),
      ]);
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const data = account.value?.data;
      if (!data || typeof data === "string" || data instanceof Uint8Array) {
        return null;
      }

      const parsed = data.parsed as {
        type?: string;
        info?: {
          decimals?: number;
          mintAuthority?: string | null;
          freezeAuthority?: string | null;
          supply?: string;
        };
      };

      if (parsed.type !== "mint") return null;

      const mintAuthority =
        parsed.info?.mintAuthority === undefined
          ? null
          : parsed.info.mintAuthority;
      const freezeAuthority =
        parsed.info?.freezeAuthority === undefined
          ? null
          : parsed.info.freezeAuthority;

      const supplyUi =
        typeof supply.value.uiAmount === "number"
          ? supply.value.uiAmount
          : supply.value.uiAmountString
            ? Number(supply.value.uiAmountString)
            : null;

      return {
        decimals: supply.value.decimals ?? parsed.info?.decimals ?? null,
        supplyUi: Number.isFinite(supplyUi) ? supplyUi : null,
        supplyRaw: supply.value.amount ?? parsed.info?.supply ?? null,
        mintAuthority,
        freezeAuthority,
        mintAuthorityActive: Boolean(mintAuthority),
        freezeAuthorityActive: Boolean(freezeAuthority),
        updatedAt: Date.now(),
      } satisfies MintSecuritySnapshot;
    }, signal);

    if (!snapshot) return null;
    setCached(cacheKey(trimmed), snapshot, ONCHAIN_STALE_MS);
    return snapshot;
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw error;
    }
    return null;
  }
}
