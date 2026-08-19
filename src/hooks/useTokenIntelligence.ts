import { useEffect, useRef, useState } from "react";
import {
  enrichTokenIntelligenceHolders,
  enrichTokenIntelligenceWhale,
  loadTokenIntelligence,
  withAxiomScore,
  type TokenIntelligence,
} from "@/lib/intelligence";
import { rememberFullAxiomScore } from "@/lib/discovery/resolvedAxiomScore";
import { SOL_MINT } from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";

/** Fail-safe so holdersLoading never stays true if enrichment hangs. */
const HOLDERS_ENRICH_FAILSAFE_MS = 90_000;
const WHALE_ENRICH_FAILSAFE_MS = 45_000;

function settleHoldersFailed(
  core: TokenIntelligence,
  message: string,
): TokenIntelligence {
  const security = {
    ...core.security,
    holderCount: null,
    topHolderPct: null,
    top10HolderPct: null,
    holdersAvailable: false,
    holdersPending: false,
    holdersStatus: "error" as const,
    holdersError: message,
  };
  return withAxiomScore(
    {
      ...core,
      security,
      holderIntel: null,
      whaleActivity: null,
      updatedAt: Date.now(),
    },
    false,
  );
}

/**
 * Loads Token Intelligence for a selected token.
 * Core → holders → whale activity (Token Detail only; never discovery).
 */
export function useTokenIntelligence(token: TokenAsset | null | undefined) {
  const [data, setData] = useState<TokenIntelligence | null>(null);
  const [loading, setLoading] = useState(false);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [whaleLoading, setWhaleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const mint = token?.mint ?? null;

  // Publish real Full Axiom Score into Live sync cache (no extra network).
  useEffect(() => {
    if (!data?.mint || !data.axiomScore) return;
    rememberFullAxiomScore(data.mint, data.axiomScore);
  }, [data?.mint, data?.axiomScore, data?.updatedAt]);

  useEffect(() => {
    const selected = tokenRef.current;
    if (!selected || !mint) {
      setData(null);
      setLoading(false);
      setHoldersLoading(false);
      setWhaleLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let enrichStarted = false;
    setLoading(true);
    setHoldersLoading(false);
    setWhaleLoading(false);
    setError(null);
    setData(null);

    void (async () => {
      try {
        const core = await loadTokenIntelligence(selected, {
          signal: controller.signal,
          includeHolders: false,
        });
        if (controller.signal.aborted) return;
        setData(core);
        setLoading(false);

        const skipHolders =
          selected.isNativeSol === true || selected.mint === SOL_MINT;
        if (skipHolders) return;

        enrichStarted = true;
        setHoldersLoading(true);

        let failsafeTimer: ReturnType<typeof setTimeout> | undefined;
        const failsoft = () =>
          settleHoldersFailed(
            core,
            "Holder analysis timed out — RPC may block getTokenLargestAccounts",
          );

        const failsafe = new Promise<TokenIntelligence>((resolve) => {
          failsafeTimer = setTimeout(
            () => resolve(failsoft()),
            HOLDERS_ENRICH_FAILSAFE_MS,
          );
        });

        const enrichPromise = enrichTokenIntelligenceHolders(
          core,
          controller.signal,
        ).catch((err) => {
          if (
            controller.signal.aborted ||
            (err instanceof DOMException && err.name === "AbortError") ||
            (err instanceof Error && err.name === "AbortError")
          ) {
            throw err;
          }
          return settleHoldersFailed(
            core,
            err instanceof Error ? err.message : "Holder analysis failed",
          );
        });

        void enrichPromise.then((enriched) => {
          if (!controller.signal.aborted) setData(enriched);
        });

        let enriched: TokenIntelligence;
        try {
          enriched = await Promise.race([enrichPromise, failsafe]);
          if (controller.signal.aborted) return;
          setData(enriched);
        } finally {
          if (failsafeTimer) clearTimeout(failsafeTimer);
          if (!controller.signal.aborted) setHoldersLoading(false);
        }

        // Whale activity — after holders settle; never blocks holder UI.
        if (
          controller.signal.aborted ||
          enriched.security.holdersStatus === "error"
        ) {
          return;
        }

        setWhaleLoading(true);
        let whaleTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          const whalePromise = enrichTokenIntelligenceWhale(
            enriched,
            controller.signal,
          ).catch((err) => {
            if (
              controller.signal.aborted ||
              (err instanceof DOMException && err.name === "AbortError")
            ) {
              throw err;
            }
            return withAxiomScore(
              {
                ...enriched,
                whaleActivity: {
                  status: "unavailable" as const,
                  events: [],
                  smartMoneyAvailable: false,
                  analyzedAccounts: 0,
                  updatedAt: Date.now(),
                  errorMessage:
                    err instanceof Error
                      ? err.message
                      : "Whale activity unavailable",
                },
              },
              false,
            );
          });

          const whaleFailsafe = new Promise<TokenIntelligence>((resolve) => {
            whaleTimer = setTimeout(
              () =>
                resolve(
                  withAxiomScore(
                    {
                      ...enriched,
                      whaleActivity: {
                        status: "unavailable",
                        events: [],
                        smartMoneyAvailable: false,
                        analyzedAccounts: 0,
                        updatedAt: Date.now(),
                        errorMessage: "Whale activity timed out",
                      },
                    },
                    false,
                  ),
                ),
              WHALE_ENRICH_FAILSAFE_MS,
            );
          });

          const withWhale = await Promise.race([whalePromise, whaleFailsafe]);
          if (!controller.signal.aborted) setData(withWhale);
        } finally {
          if (whaleTimer) clearTimeout(whaleTimer);
          if (!controller.signal.aborted) setWhaleLoading(false);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "Token intelligence unavailable",
        );
        setData((prev) => {
          if (!prev) return prev;
          if (
            prev.security.holdersPending ||
            prev.security.holdersStatus === "pending"
          ) {
            return settleHoldersFailed(
              prev,
              err instanceof Error ? err.message : "Holder analysis failed",
            );
          }
          return prev;
        });
      } finally {
        if (!controller.signal.aborted) {
          setHoldersLoading(false);
          setWhaleLoading(false);
          setLoading(false);
          setData((prev) => {
            if (
              !prev ||
              !enrichStarted ||
              (prev.security.holdersStatus !== "pending" &&
                !prev.security.holdersPending)
            ) {
              return prev;
            }
            return settleHoldersFailed(
              prev,
              "Holder analysis did not complete",
            );
          });
        }
      }
    })();

    return () => controller.abort();
  }, [mint]);

  return { data, loading, holdersLoading, whaleLoading, error };
}
