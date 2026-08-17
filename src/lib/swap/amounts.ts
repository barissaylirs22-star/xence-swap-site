/** Convert a decimal UI amount string to raw integer units. */
export function toRawAmount(uiAmount: string, decimals: number): string | null {
  const trimmed = uiAmount.trim();
  if (!trimmed || !/^\d*\.?\d+$/.test(trimmed)) return null;

  const [wholePart = "0", fracPart = ""] = trimmed.split(".");
  if (fracPart.length > decimals) return null;

  const paddedFrac = fracPart.padEnd(decimals, "0");
  const raw = `${wholePart.replace(/^0+(?=\d)/, "") || "0"}${paddedFrac}`.replace(
    /^0+(?=\d)/,
    "",
  );
  return raw || "0";
}

/** Format raw integer units to a compact UI amount string. */
export function fromRawAmount(
  raw: string,
  decimals: number,
  maxFrac = 6,
): string {
  if (!/^\d+$/.test(raw)) return "—";
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "").slice(0, maxFrac);
  return frac ? `${Number(whole)}.${frac}` : `${Number(whole)}`;
}

export function isPositiveAmount(uiAmount: string): boolean {
  const n = Number(uiAmount);
  return Number.isFinite(n) && n > 0;
}
