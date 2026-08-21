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

const FRIENDLY_INTEL_ERROR = "Token intelligence unavailable";
const FRIENDLY_HOLDERS_ERROR = "Holder analysis unavailable";
const FRIENDLY_HOLDERS_TIMEOUT = "Holder analysis timed out";
const FRIENDLY_WHALE_ERROR = "Whale activity unavailable";
const FRIENDLY_WHALE_TIMEOUT = "Whale activity timed out";

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
  const requestMintRef = useRef<string | null>(null);

  const mint = token?.mint ?? null;

  // Publish real Full Axiom Score into Live sync cache (no extra network).
  useEffect(() => {
    if (!data?.mint || !data.axiomScore) return;
    rememberFullAxiomScore(data.mint, data.axiomScore);
  }, [data?.mint, data?.axiomScore, data?.updatedAt]);

  useEffect(() => {
    const selected = tokenRef.current;
    if (!selected || !mint) {
      requestMintRef.current = null;
      setData(null);
      setLoading(false);
      setHoldersLoading(false);
      setWhaleLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let enrichStarted = false;
    requestMintRef.current = mint;
    setLoading(true);
    setHoldersLoading(false);
    setWhaleLoading(false);
    setError(null);
    setData(null);

    const isCurrent = () =>
      !controller.signal.aborted && requestMintRef.current === mint;

    void (async () => {
      try {
        const core = await loadTokenIntelligence(selected, {
          signal: controller.signal,
          includeHolders: false,
        });
        if (!isCurrent()) return;
        // Guard: response must match the open token.
        if (core.mint && core.mint !== mint) return;
        setData(core);
        setLoading(false);

        const skipHolders =
          selected.isNativeSol === true || selected.mint === SOL_MINT;
        if (skipHolders) return;

        enrichStarted = true;
        setHoldersLoading(true);

        let failsafeTimer: ReturnType<typeof setTimeout> | undefined;
        const failsoft = () =>
          settleHoldersFailed(core, FRIENDLY_HOLDERS_TIMEOUT);

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
          if (import.meta.env.DEV) {
            console.info(
              "[token-intel] holders enrich failed",
              err instanceof Error ? err.message : "unknown",
            );
          }
          return settleHoldersFailed(core, FRIENDLY_HOLDERS_ERROR);
        });

        void enrichPromise.then((enriched) => {
          if (isCurrent()) setData(enriched);
        });

        let enriched: TokenIntelligence;
        try {
          enriched = await Promise.race([enrichPromise, failsafe]);
          if (!isCurrent()) return;
          setData(enriched);
        } finally {
          if (failsafeTimer) clearTimeout(failsafeTimer);
          if (isCurrent()) setHoldersLoading(false);
        }

        // Whale activity — after holders settle; never blocks holder UI.
        if (
          !isCurrent() ||
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
            if (import.meta.env.DEV) {
              console.info(
                "[token-intel] whale enrich failed",
                err instanceof Error ? err.message : "unknown",
              );
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
                  errorMessage: FRIENDLY_WHALE_ERROR,
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
                        errorMessage: FRIENDLY_WHALE_TIMEOUT,
                      },
                    },
                    false,
                  ),
                ),
              WHALE_ENRICH_FAILSAFE_MS,
            );
          });

          const withWhale = await Promise.race([whalePromise, whaleFailsafe]);
          if (isCurrent()) setData(withWhale);
        } finally {
          if (whaleTimer) clearTimeout(whaleTimer);
          if (isCurrent()) setWhaleLoading(false);
        }
      } catch (err) {
        if (!isCurrent()) return;
        if (import.meta.env.DEV) {
          console.info(
            "[token-intel] core load failed",
            err instanceof Error ? err.message : "unknown",
          );
        }
        setError(FRIENDLY_INTEL_ERROR);
        setData((prev) => {
          if (!prev || prev.mint !== mint) return prev;
          if (
            prev.security.holdersPending ||
            prev.security.holdersStatus === "pending"
          ) {
            return settleHoldersFailed(prev, FRIENDLY_HOLDERS_ERROR);
          }
          return prev;
        });
      } finally {
        if (isCurrent()) {
          setHoldersLoading(false);
          setWhaleLoading(false);
          setLoading(false);
          setData((prev) => {
            if (
              !prev ||
              prev.mint !== mint ||
              !enrichStarted ||
              (prev.security.holdersStatus !== "pending" &&
                !prev.security.holdersPending)
            ) {
              return prev;
            }
            return settleHoldersFailed(prev, FRIENDLY_HOLDERS_ERROR);
          });
        }
      }
    })();

    return () => controller.abort();
  }, [mint]);

  return { data, loading, holdersLoading, whaleLoading, error };
}
