declare module "*solanaRpcFailover.mjs" {
  export const SOLANA_RPC_PROXY_PATH: string;
  export const STANDARD_RPC_ALLOWED_METHODS: Set<string>;
  export function resolveStandardRpcPrimary(
    env: Record<string, string | undefined> | null | undefined,
  ): string;
  export function resolveStandardRpcFallback(
    env: Record<string, string | undefined> | null | undefined,
  ): string | null;
  export function safeRpcErrorMessage(error: unknown): string;
  export function forwardStandardRpcWithFailover(opts: {
    body: string;
    primaryUrl: string;
    fallbackUrl: string | null;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }): Promise<{
    status: number;
    text: string;
    used: "primary" | "fallback";
    fallbackAttempted: boolean;
  }>;
}
