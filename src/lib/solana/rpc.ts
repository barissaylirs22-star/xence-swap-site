import { getActiveMint, isLaunchLive } from "@/config/launch";
import type { OnChainTokenFacts } from "@/types/token";
import { EMPTY_ONCHAIN } from "@/types/token";

/** Same-origin standard RPC proxy — Provider B stays server-side. */
const SOLANA_RPC_PROXY = "/api/solana-rpc";

interface RpcResponse<T> {
  result?: T;
  error?: { message?: string };
}

interface TokenSupplyAmount {
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString?: string;
}

/** On-chain reads — disabled until launch mint is configured. */
export async function fetchLiveOnChainFacts(
  signal?: AbortSignal,
): Promise<OnChainTokenFacts> {
  if (!isLaunchLive()) {
    return { ...EMPTY_ONCHAIN };
  }

  const mint = getActiveMint();
  if (!mint) return { ...EMPTY_ONCHAIN };

  const supplyBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenSupply",
    params: [mint],
  };

  const accountBody = {
    jsonrpc: "2.0",
    id: 2,
    method: "getAccountInfo",
    params: [mint, { encoding: "jsonParsed" }],
  };

  const [supplyRes, accountRes] = await Promise.all([
    fetch(SOLANA_RPC_PROXY, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(supplyBody),
    }),
    fetch(SOLANA_RPC_PROXY, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountBody),
    }),
  ]);

  if (!supplyRes.ok && !accountRes.ok) {
    throw new Error("Solana RPC unavailable");
  }

  const supplyJson = (await supplyRes.json()) as RpcResponse<{
    value: TokenSupplyAmount;
  }>;
  const accountJson = (await accountRes.json()) as RpcResponse<{
    value: {
      data?: {
        parsed?: {
          info?: {
            decimals?: number;
            mintAuthority?: string | null;
            freezeAuthority?: string | null;
          };
        };
      };
    } | null;
  }>;

  if (supplyJson.error && accountJson.error) {
    throw new Error(
      supplyJson.error.message ?? "Failed to read mint from Solana RPC",
    );
  }

  const supply = supplyJson.result?.value;
  const info = accountJson.result?.value?.data?.parsed?.info;

  return {
    decimals: supply?.decimals ?? info?.decimals ?? null,
    supplyUi:
      typeof supply?.uiAmount === "number"
        ? supply.uiAmount
        : supply?.uiAmountString
          ? Number(supply.uiAmountString)
          : null,
    mintAuthority: info?.mintAuthority,
    freezeAuthority: info?.freezeAuthority,
    updatedAt: new Date().toISOString(),
    error: null,
  };
}

export function emptyOnChainWithError(message: string): OnChainTokenFacts {
  return { ...EMPTY_ONCHAIN, error: message };
}
