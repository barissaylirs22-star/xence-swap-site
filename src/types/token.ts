export interface OnChainTokenFacts {
  decimals: number | null;
  supplyUi: number | null;
  mintAuthority: string | null | undefined;
  freezeAuthority: string | null | undefined;
  updatedAt: string | null;
  error: string | null;
}

export const EMPTY_ONCHAIN: OnChainTokenFacts = {
  decimals: null,
  supplyUi: null,
  mintAuthority: undefined,
  freezeAuthority: undefined,
  updatedAt: null,
  error: null,
};
