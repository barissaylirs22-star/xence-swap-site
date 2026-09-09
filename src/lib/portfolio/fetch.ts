import { PublicKey } from "@solana/web3.js";
import { withMainnetRpc } from "@/lib/solana/connection";
import { lamportsToSolUi } from "./format";
import { aggregateTokenAccounts, toTokenDisplayRows } from "./parse";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./programs";
import type { PortfolioSnapshot } from "./types";

function invalidOwner(owner: string): boolean {
  try {
    void new PublicKey(owner);
    return false;
  } catch {
    return true;
  }
}

function lamportsToRaw(lamports: number): string | null {
  if (!Number.isFinite(lamports) || lamports < 0 || !Number.isSafeInteger(lamports)) {
    return null;
  }
  return BigInt(lamports).toString();
}

/**
 * Load native SOL + SPL holdings for one owner.
 * RPC: getBalance + getParsedTokenAccountsByOwner (Token Program)
 *      + getParsedTokenAccountsByOwner (Token-2022).
 * Sequential failover via withMainnetRpc. No per-token requests.
 */
export async function fetchPortfolioSnapshot(options: {
  owner: string;
  signal?: AbortSignal;
}): Promise<PortfolioSnapshot> {
  if (invalidOwner(options.owner)) {
    throw new Error("invalid_owner");
  }

  const owner = new PublicKey(options.owner);
  const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
  const token2022Program = new PublicKey(TOKEN_2022_PROGRAM_ID);

  const result = await withMainnetRpc(async (connection) => {
    const lamports = await connection.getBalance(owner, "confirmed");
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const spl = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: tokenProgram,
    });
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    let token2022Ok = true;
    let token2022Rows: unknown[] = [];
    try {
      const t22 = await connection.getParsedTokenAccountsByOwner(owner, {
        programId: token2022Program,
      });
      token2022Rows = t22.value;
    } catch {
      token2022Ok = false;
    }

    return {
      lamports,
      rows: [...spl.value, ...token2022Rows],
      token2022Ok,
    };
  }, options.signal);

  const solLamports = lamportsToRaw(result.lamports);
  if (solLamports === null) {
    throw new Error("invalid_sol_balance");
  }

  const aggregated = aggregateTokenAccounts(result.rows);
  const tokens = toTokenDisplayRows(aggregated).map((row) => ({
    ...row,
    symbol: null,
    name: null,
    iconUrl: null,
  }));

  return {
    owner: options.owner,
    solLamports,
    solUiAmount: lamportsToSolUi(solLamports),
    tokens,
    token2022Ok: result.token2022Ok,
  };
}
