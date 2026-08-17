import { getPrimarySolanaRpcUrl } from "@/lib/solana/rpcEndpoints";
import { MAINNET_GENESIS_HASH } from "@/lib/swap/network";
import type { ConnectedWallet } from "./types";

const isDev = import.meta.env.DEV;

function info(...args: unknown[]) {
  if (isDev) console.info("[axiom:wallet]", ...args);
}

/** Development-only Phantom / Solana provider diagnostics (no secrets). */
export function logWalletProviderDiagnostics(label: string): void {
  if (!isDev || typeof window === "undefined") return;

  const phantomSolana = window.phantom?.solana;
  const windowSolana = window.solana;
  const ethereum = (window as Window & { ethereum?: { isPhantom?: boolean } })
    .ethereum;

  info(label, {
    hasPhantomNamespace: Boolean(phantomSolana),
    phantomIsPhantom: Boolean(phantomSolana?.isPhantom),
    phantomIsConnected: Boolean(phantomSolana?.isConnected),
    hasWindowSolana: Boolean(windowSolana),
    windowSolanaIsPhantom: Boolean(windowSolana?.isPhantom),
    // Ensure we are not mistaking an EVM provider for Solana.
    hasEthereum: Boolean(ethereum),
    ethereumIsPhantom: Boolean(ethereum?.isPhantom),
    preferredProvider:
      phantomSolana && phantomSolana.isPhantom
        ? "window.phantom.solana"
        : windowSolana?.isPhantom
          ? "window.solana (isPhantom)"
          : "none",
    rpcPrimary: getPrimarySolanaRpcUrl(),
    expectedMainnetGenesis: MAINNET_GENESIS_HASH,
  });
}

export function logConnectedWalletDiagnostics(
  wallet: ConnectedWallet | null,
  label = "connected",
): void {
  if (!isDev) return;
  info(label, {
    connected: Boolean(wallet),
    walletId: wallet?.id ?? null,
    // Public key only — never private material.
    publicKey: wallet?.publicKey
      ? `${wallet.publicKey.slice(0, 4)}…${wallet.publicKey.slice(-4)}`
      : null,
    publicKeyLength: wallet?.publicKey?.length ?? 0,
    canSignTransaction: Boolean(wallet?.signTransaction),
    canSignAndSend: Boolean(wallet?.signAndSendTransaction),
  });
}

export function logReadinessBlockReason(reason: string, detail?: unknown): void {
  if (!isDev) return;
  info("readiness.false", { reason, detail: detail ?? null });
}
