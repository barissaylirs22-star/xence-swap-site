/** Format raw integer units to a UI decimal string without Number() aggregation. */
export function formatRawUnits(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return "—";
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return "—";
  if (decimals === 0) return raw.replace(/^0+(?=\d)/, "") || "0";
  const padded = raw.padStart(decimals + 1, "0");
  const whole =
    padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, "") || "0";
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function lamportsToSolUi(lamports: string): string {
  return formatRawUnits(lamports, 9);
}
