import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PORTFOLIO } from "@/content/copy";
import { AxiomDiscoveryContext } from "@/lib/discovery/AxiomDiscoveryContext";
import { fetchPortfolioSnapshot } from "@/lib/portfolio/fetch";
import { resolvePortfolioMeta } from "@/lib/portfolio/metadata";
import { createPortfolioLoadGate } from "@/lib/portfolio/session";
import type { PortfolioSnapshot, PortfolioStatus } from "@/lib/portfolio/types";
import { useWallet } from "@/lib/wallet/useWallet";

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; message?: string };
  return (
    err.name === "AbortError" ||
    `${err.message ?? ""}`.toLowerCase().includes("aborted")
  );
}

export function usePortfolio() {
  const { wallet, connecting, connect, disconnect, error: walletError } =
    useWallet();
  const discovery = useContext(AxiomDiscoveryContext);

  const [status, setStatus] = useState<PortfolioStatus>("disconnected");
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const gateRef = useRef(createPortfolioLoadGate());
  const owner = wallet?.publicKey ?? null;

  useEffect(() => {
    const gate = gateRef.current;

    if (!owner) {
      gate.abort();
      setSnapshot(null);
      setMessage(null);
      setStatus("disconnected");
      return;
    }

    const load = gate.start(owner);
    setSnapshot(null);
    setMessage(null);
    setStatus("loading");

    void (async () => {
      try {
        const next = await fetchPortfolioSnapshot({
          owner,
          signal: load.signal,
        });
        if (!load.isCurrent() || load.owner !== owner) return;
        setSnapshot(next);
        setStatus(next.tokens.length === 0 ? "empty" : "ready");
        setMessage(
          next.token2022Ok ? null : PORTFOLIO.token2022Unavailable,
        );
      } catch (error) {
        if (!load.isCurrent() || load.owner !== owner) return;
        if (isAbortError(error) || load.signal?.aborted) return;
        setSnapshot(null);
        setStatus("unavailable");
        setMessage(PORTFOLIO.unavailable);
      }
    })();

    return () => {
      gate.abort();
    };
  }, [owner, refreshNonce]);

  const refresh = useCallback(() => {
    if (!owner) return;
    setRefreshNonce((n) => n + 1);
  }, [owner]);

  const viewSnapshot = useMemo((): PortfolioSnapshot | null => {
    if (!snapshot) return null;
    const knownTokens = discovery?.universe ?? [];
    return {
      ...snapshot,
      tokens: snapshot.tokens.map((row) => {
        const meta = resolvePortfolioMeta(row.mint, knownTokens);
        return {
          ...row,
          symbol: meta.symbol,
          name: meta.name,
          iconUrl: meta.iconUrl,
        };
      }),
    };
  }, [snapshot, discovery]);

  return {
    status,
    owner,
    snapshot: viewSnapshot,
    message,
    walletError,
    connecting,
    connect,
    disconnect,
    refresh,
  };
}
