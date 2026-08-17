import { useEffect, useState } from "react";
import { searchTokens } from "@/lib/tokens/discovery";
import type { TokenAsset } from "@/lib/tokens/types";

export function useTokenSearch(options: {
  query: string;
  excludeMint?: string;
  balances?: Record<string, number | null>;
  open: boolean;
}) {
  const [tokens, setTokens] = useState<TokenAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const balanceKey = JSON.stringify(options.balances ?? {});

  useEffect(() => {
    if (!options.open) return;
    // Browse mode (empty query) is handled by useTokenBrowse.
    if (!options.query.trim()) {
      setTokens([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const balances = balanceKey
      ? (JSON.parse(balanceKey) as Record<string, number | null>)
      : {};

    const handle = window.setTimeout(() => {
      setLoading(true);
      void searchTokens({
        query: options.query,
        excludeMint: options.excludeMint,
        balances,
        signal: controller.signal,
      })
        .then((results) => {
          if (!controller.signal.aborted) {
            setTokens(results);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setTokens([]);
            setLoading(false);
          }
        });
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [options.open, options.query, options.excludeMint, balanceKey]);

  return { tokens, loading };
}
