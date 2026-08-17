import { getActiveMint } from "@/config/launch";

export function solscanTokenUrl(mint?: string | null): string | null {
  const m = mint ?? getActiveMint();
  if (!m) return null;
  return `https://solscan.io/token/${m}`;
}

export function solanaExplorerTokenUrl(mint?: string | null): string | null {
  const m = mint ?? getActiveMint();
  if (!m) return null;
  return `https://explorer.solana.com/address/${m}`;
}

export function truncateAddress(value: string, left = 4, right = 4): string {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export function solscanTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}
