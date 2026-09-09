export type PortfolioStatus =
  | "disconnected"
  | "loading"
  | "ready"
  | "empty"
  | "unavailable";

export interface PortfolioTokenRow {
  mint: string;
  rawAmount: string;
  decimals: number;
  uiAmount: string;
  symbol: string | null;
  name: string | null;
  iconUrl: string | null;
}

export interface PortfolioSnapshot {
  owner: string;
  solLamports: string;
  solUiAmount: string;
  tokens: PortfolioTokenRow[];
  /** False when Token-2022 owner query failed after Token Program succeeded. */
  token2022Ok: boolean;
}

export interface PortfolioView {
  status: PortfolioStatus;
  owner: string | null;
  snapshot: PortfolioSnapshot | null;
  message: string | null;
}
