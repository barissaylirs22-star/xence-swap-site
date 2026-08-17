import { useEffect, useState } from "react";
import { loadTokenBrowseSections } from "@/lib/tokens/browse";
import type { TokenBrowseSection } from "@/lib/tokens/types";

export function useTokenBrowse(options: {
  open: boolean;
  /** Only load browse sections when search is empty. */
  query: string;
  excludeMint?: string;
  balances?: Record<string, number | null>;
}) {
  const [sections, setSections] = useState<TokenBrowseSection[]>([]);
  const [loading, setLoading] = useState(false);
  const balanceKey = JSON.stringify(options.balances ?? {});
  const browsing = options.open && options.query.trim().length === 0;

  useEffect(() => {
    if (!browsing) return;

    const controller = new AbortController();
    const balances = balanceKey
      ? (JSON.parse(balanceKey) as Record<string, number | null>)
      : {};

    setLoading(true);
    void loadTokenBrowseSections({
      signal: controller.signal,
      balances,
      excludeMint: options.excludeMint,
    })
      .then((next) => {
        if (!controller.signal.aborted) {
          setSections(next);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSections([
            {
              id: "popular",
              title: "Popular",
              tokens: [],
            },
            {
              id: "trending",
              title: "Trending",
              tokens: [],
              unavailable: true,
            },
            {
              id: "new",
              title: "New / Pump.fun",
              tokens: [],
              unavailable: true,
            },
          ]);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [browsing, options.excludeMint, balanceKey]);

  return { sections, loading, browsing };
}
