import { looksLikeMintAddress } from "@/lib/tokens/catalog";
import { formatRawUnits } from "./format";

export interface AggregatedMintBalance {
  mint: string;
  rawAmount: bigint;
  decimals: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function readParsedInfo(row: unknown): Record<string, unknown> | null {
  const root = asRecord(row);
  if (!root) return null;
  const account = asRecord(root.account) ?? root;
  const data = asRecord(account.data);
  if (!data) return null;
  const parsed = asRecord(data.parsed);
  if (!parsed) return null;
  const info = asRecord(parsed.info);
  return info;
}

/**
 * Parse one getParsedTokenAccountsByOwner row.
 * Malformed rows return null (fail-closed, never throw).
 */
export function parseTokenAccountRow(
  row: unknown,
): AggregatedMintBalance | null {
  try {
    const info = readParsedInfo(row);
    if (!info) return null;
    const mint = typeof info.mint === "string" ? info.mint.trim() : "";
    if (!looksLikeMintAddress(mint)) return null;

    const tokenAmount = asRecord(info.tokenAmount);
    if (!tokenAmount) return null;

    const amount =
      typeof tokenAmount.amount === "string" ? tokenAmount.amount.trim() : "";
    if (!/^\d+$/.test(amount)) return null;

    const decimals = tokenAmount.decimals;
    if (
      typeof decimals !== "number" ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 18
    ) {
      return null;
    }

    return {
      mint,
      rawAmount: BigInt(amount),
      decimals,
    };
  } catch {
    return null;
  }
}

/**
 * Aggregate token accounts by mint using bigint raw amounts.
 * Zero balances excluded. Conflicting decimals for the same mint skip the extra row.
 */
export function aggregateTokenAccounts(
  rows: unknown[],
): AggregatedMintBalance[] {
  const byMint = new Map<string, AggregatedMintBalance>();

  for (const row of rows) {
    const parsed = parseTokenAccountRow(row);
    if (!parsed) continue;
    const existing = byMint.get(parsed.mint);
    if (!existing) {
      byMint.set(parsed.mint, parsed);
      continue;
    }
    if (existing.decimals !== parsed.decimals) continue;
    existing.rawAmount += parsed.rawAmount;
  }

  return [...byMint.values()].filter((row) => row.rawAmount > 0n);
}

export function toTokenDisplayRows(
  aggregated: AggregatedMintBalance[],
): Array<{
  mint: string;
  rawAmount: string;
  decimals: number;
  uiAmount: string;
}> {
  return aggregated
    .map((row) => ({
      mint: row.mint,
      rawAmount: row.rawAmount.toString(),
      decimals: row.decimals,
      uiAmount: formatRawUnits(row.rawAmount.toString(), row.decimals),
    }))
    .sort((a, b) => a.mint.localeCompare(b.mint));
}
