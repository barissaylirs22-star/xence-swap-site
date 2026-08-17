import { PublicKey } from "@solana/web3.js";
import { withMainnetRpc } from "@/lib/solana/connection";
import { SOL_MINT } from "@/lib/tokens/catalog";
import { isSwapTerminalEnabled } from "./gate";

export type BalanceStatus = "ok" | "unavailable" | "skipped";

export interface TokenBalanceResult {
  uiAmount: number | null;
  status: BalanceStatus;
}

function invalidOwnerOrMint(owner: string, mint: string): boolean {
  try {
    void new PublicKey(owner);
    void new PublicKey(mint);
    return false;
  } catch {
    return true;
  }
}

/** Fetch wallet balance for SOL or an SPL mint. Never throws to UI callers. */
export async function fetchTokenUiBalance(options: {
  owner: string;
  mint: string;
  decimals: number;
  signal?: AbortSignal;
}): Promise<TokenBalanceResult> {
  if (!isSwapTerminalEnabled() || !options.mint || options.decimals < 0) {
    return { uiAmount: null, status: "skipped" };
  }

  if (invalidOwnerOrMint(options.owner, options.mint)) {
    return { uiAmount: null, status: "unavailable" };
  }

  if (options.signal?.aborted) {
    return { uiAmount: null, status: "skipped" };
  }

  try {
    const owner = new PublicKey(options.owner);

    if (options.mint === SOL_MINT) {
      const lamports = await withMainnetRpc(
        (connection) => connection.getBalance(owner, "confirmed"),
        options.signal,
      );
      if (options.signal?.aborted) {
        return { uiAmount: null, status: "skipped" };
      }
      return {
        uiAmount: lamports / 10 ** options.decimals,
        status: "ok",
      };
    }

    const mint = new PublicKey(options.mint);
    const accounts = await withMainnetRpc(
      (connection) =>
        connection.getParsedTokenAccountsByOwner(owner, { mint }),
      options.signal,
    );
    if (options.signal?.aborted) {
      return { uiAmount: null, status: "skipped" };
    }

    const total = accounts.value.reduce((sum, account) => {
      const amount = account.account.data.parsed?.info?.tokenAmount?.uiAmount;
      return sum + (typeof amount === "number" ? amount : 0);
    }, 0);

    return { uiAmount: total, status: "ok" };
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      return { uiAmount: null, status: "skipped" };
    }
    return { uiAmount: null, status: "unavailable" };
  }
}
