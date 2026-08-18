import { useEffect, useRef, useState } from "react";
import type { DiscoveryEnrichment } from "@/lib/discovery/filters";
import { assessDiscoveryRiskLite } from "@/lib/discovery/riskLite";
import { persistHolderObservation } from "@/lib/intelligence/holderHistory";
import { fetchHolderConcentration } from "@/lib/intelligence/holders";
import { getCached, setCached } from "@/lib/market/cache";
import type { TokenAsset } from "@/lib/tokens/types";

const ENRICH_TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 45_000;
/** Never run more than one heavy holder fetch at a time (protects Helius). */
const CONCURRENCY = 1;
/** Cap how many tokens we census per panel session. */
const MAX_SESSION_ENRICH = 24;

function enrichCacheKey(mint: string): string {
  return `discovery:enrich:v1:${mint}`;
}

function withGrowthField(
  entry: Omit<DiscoveryEnrichment, "holderGrowth"> & {
    holderGrowth?: DiscoveryEnrichment["holderGrowth"];
  },
): DiscoveryEnrichment {
  return {
    ...entry,
    holderGrowth: entry.holderGrowth ?? null,
  };
}

/**
 * Progressive holder/risk enrichment for visible discovery rows.
 * Uses full concentration+census but with concurrency 1 and a session cap.
 * Successful real snapshots POST once to /api/holder-intel (zero extra Helius);
 * intel.growth from that SAME response is captured into enrichment state (no UI yet).
 */
export function useDiscoveryEnrichment(
  tokens: TokenAsset[],
  enabled: boolean,
) {
  const [enrichment, setEnrichment] = useState<
    Map<string, DiscoveryEnrichment>
  >(() => new Map());
  const visibleRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const inflightRef = useRef(0);
  const doneRef = useRef<Set<string>>(new Set());
  const sessionCountRef = useRef(0);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const enrichmentRef = useRef(enrichment);
  enrichmentRef.current = enrichment;

  // Seed from cache when token set changes.
  useEffect(() => {
    if (!enabled) return;
    setEnrichment((prev) => {
      const next = new Map(prev);
      for (const token of tokens) {
        if (next.has(token.mint) || doneRef.current.has(token.mint)) continue;
        const cached = getCached<DiscoveryEnrichment>(enrichCacheKey(token.mint));
        if (cached) {
          next.set(token.mint, withGrowthField(cached));
          doneRef.current.add(token.mint);
        }
      }
      return next;
    });
  }, [tokens, enabled]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const controllers = new Map<string, AbortController>();

    const pump = () => {
      if (cancelled) return;
      while (
        inflightRef.current < CONCURRENCY &&
        queueRef.current.length > 0 &&
        sessionCountRef.current < MAX_SESSION_ENRICH
      ) {
        const mint = queueRef.current.shift();
        if (!mint || doneRef.current.has(mint)) continue;

        const token = tokensRef.current.find((t) => t.mint === mint);
        if (!token) continue;

        doneRef.current.add(mint);
        sessionCountRef.current += 1;
        inflightRef.current += 1;

        setEnrichment((prev) => {
          const next = new Map(prev);
          next.set(
            mint,
            withGrowthField({
              holderCount: null,
              topHolderPct: null,
              top10HolderPct: null,
              riskLevel: null,
              status: "loading",
              holderGrowth: null,
            }),
          );
          return next;
        });

        const controller = new AbortController();
        controllers.set(mint, controller);

        void (async () => {
          try {
            // Discovery uses census for Most Holders, but never in parallel.
            const snap = await fetchHolderConcentration(
              mint,
              null,
              controller.signal,
              { includeCensus: true },
            );

            const concentrationOk =
              snap.status === "ok" &&
              (snap.topHolderPct != null || snap.top10HolderPct != null);

            const risk = assessDiscoveryRiskLite({
              token,
              topHolderPct: concentrationOk ? snap.topHolderPct : null,
              top10HolderPct: concentrationOk ? snap.top10HolderPct : null,
            });

            const entry: DiscoveryEnrichment = withGrowthField({
              holderCount:
                snap.holderCount != null && Number.isFinite(snap.holderCount)
                  ? snap.holderCount
                  : null,
              topHolderPct: concentrationOk ? snap.topHolderPct : null,
              top10HolderPct: concentrationOk ? snap.top10HolderPct : null,
              riskLevel: risk.level,
              status:
                concentrationOk || snap.holderCount != null
                  ? "ready"
                  : "unavailable",
              holderGrowth: null,
            });

            // Exactly one holder-intel POST per fresh successful enrichment.
            // Capture intel.growth from the SAME response; never block / fail enrichment.
            if (entry.status === "ready") {
              persistHolderObservation(
                mint,
                {
                  holderCount: entry.holderCount,
                  topHolderPct: entry.topHolderPct,
                  top10HolderPct: entry.top10HolderPct,
                  priceUsd: token.priceUsd ?? null,
                  liquidityUsd: token.liquidityUsd ?? null,
                  marketCapUsd: token.marketCapUsd ?? token.fdvUsd ?? null,
                },
                (result) => {
                  if (!result.growth) return;
                  const merge = (cur: DiscoveryEnrichment | undefined) => {
                    if (!cur || cur.status !== "ready") return null;
                    return withGrowthField({
                      ...cur,
                      holderGrowth: result.growth,
                    });
                  };
                  setEnrichment((prev) => {
                    const updated = merge(prev.get(mint));
                    if (!updated) return prev;
                    const next = new Map(prev);
                    next.set(mint, updated);
                    setCached(enrichCacheKey(mint), updated, ENRICH_TTL_MS);
                    return next;
                  });
                },
              );
            }

            if (cancelled || controller.signal.aborted) return;

            setCached(
              enrichCacheKey(mint),
              entry,
              entry.status === "ready" ? ENRICH_TTL_MS : FAIL_TTL_MS,
            );

            setEnrichment((prev) => {
              const next = new Map(prev);
              // Keep growth if a racing POST already merged it.
              const existing = prev.get(mint);
              next.set(
                mint,
                withGrowthField({
                  ...entry,
                  holderGrowth: existing?.holderGrowth ?? entry.holderGrowth,
                }),
              );
              return next;
            });
          } catch (err) {
            if (
              cancelled ||
              (err instanceof DOMException && err.name === "AbortError")
            ) {
              doneRef.current.delete(mint);
              return;
            }
            const fail = withGrowthField({
              holderCount: null,
              topHolderPct: null,
              top10HolderPct: null,
              riskLevel: assessDiscoveryRiskLite({
                token,
                topHolderPct: null,
                top10HolderPct: null,
              }).level,
              status: "unavailable",
              holderGrowth: null,
            });
            setCached(enrichCacheKey(mint), fail, FAIL_TTL_MS);
            setEnrichment((prev) => {
              const next = new Map(prev);
              next.set(mint, fail);
              return next;
            });
          } finally {
            controllers.delete(mint);
            inflightRef.current = Math.max(0, inflightRef.current - 1);
            pump();
          }
        })();
      }
    };

    const enqueue = (mint: string, front = false) => {
      if (!mint || doneRef.current.has(mint)) return;
      if (enrichmentRef.current.get(mint)?.status === "ready") return;
      if (queueRef.current.includes(mint)) return;
      if (sessionCountRef.current >= MAX_SESSION_ENRICH) return;
      if (front) queueRef.current.unshift(mint);
      else queueRef.current.push(mint);
      pump();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const mint = (entry.target as HTMLElement).dataset.mint;
          if (!mint) continue;
          if (entry.isIntersecting) {
            visibleRef.current.add(mint);
            enqueue(mint, true);
          } else {
            visibleRef.current.delete(mint);
          }
        }
      },
      { root: null, rootMargin: "120px 0px", threshold: 0.01 },
    );

    // Observe current DOM nodes marked for enrichment.
    const observeAll = () => {
      document
        .querySelectorAll<HTMLElement>("[data-discovery-enrich='1']")
        .forEach((el) => observer.observe(el));
    };

    observeAll();
    const mo = new MutationObserver(() => observeAll());
    mo.observe(document.body, { childList: true, subtree: true });

    // Preferentially queue first page by volume for Most Holders / Low Risk warm-up.
    const warm = [...tokens]
      .filter((t) => t.volume24hUsd != null)
      .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
      .slice(0, 8);
    for (const t of warm) enqueue(t.mint);

    return () => {
      cancelled = true;
      observer.disconnect();
      mo.disconnect();
      for (const c of controllers.values()) c.abort();
    };
  }, [enabled, tokens]);

  return enrichment;
}
