/** Well-known SPL program IDs — public constants, not secrets. */
export const TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export const TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** RPC methods used for one Portfolio V1 refresh (not per token). */
export const PORTFOLIO_RPC_METHODS = [
  "getBalance",
  "getParsedTokenAccountsByOwner",
  "getParsedTokenAccountsByOwner",
] as const;
