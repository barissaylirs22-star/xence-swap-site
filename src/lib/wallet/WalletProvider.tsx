import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  logConnectedWalletDiagnostics,
  logWalletProviderDiagnostics,
} from "./diagnostics";
import { toPublicWalletMessage, WalletError } from "./errors";
import {
  getPreferredWalletAdapter,
  getWalletAdapter,
  listWalletDescriptors,
} from "./injected";
import type { ConnectedWallet, WalletDescriptor } from "./types";
import { WalletContext } from "./wallet-context";

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState<WalletDescriptor[]>(() =>
    listWalletDescriptors(),
  );

  const refreshWallets = useCallback(() => {
    setWallets(listWalletDescriptors());
  }, []);

  useEffect(() => {
    refreshWallets();
    const onFocus = () => refreshWallets();
    window.addEventListener("focus", onFocus);
    // Extensions often inject after first paint.
    const t1 = window.setTimeout(refreshWallets, 250);
    const t2 = window.setTimeout(refreshWallets, 1000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [refreshWallets]);

  // Silent reconnect if previously approved (does not prompt).
  // Locked / rejected / missing wallet must never crash the page.
  useEffect(() => {
    let cancelled = false;
    logWalletProviderDiagnostics("boot");
    const adapter = getPreferredWalletAdapter("phantom");
    if (!adapter || adapter.detect() !== "installed") {
      logWalletProviderDiagnostics("boot.phantomMissing");
      return;
    }

    void (async () => {
      try {
        const connected = await adapter.connect({ onlyIfTrusted: true });
        if (!cancelled) {
          setWallet(connected);
          setError(null);
          logConnectedWalletDiagnostics(connected, "trustedReconnect");
        }
      } catch {
        if (!cancelled) {
          setWallet(null);
          // Silent on refresh — user can click Connect Wallet.
          setError(null);
          logConnectedWalletDiagnostics(null, "trustedReconnect.skipped");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep React state in sync with provider account/disconnect events.
  useEffect(() => {
    if (!wallet) return;
    const adapter = getWalletAdapter(wallet.id);
    if (!adapter?.subscribe) return;

    return adapter.subscribe({
      onAccountChange: (publicKey) => {
        if (!publicKey) {
          setWallet(null);
          return;
        }
        setWallet((prev) =>
          prev ? { ...prev, publicKey } : prev,
        );
      },
      onDisconnect: () => setWallet(null),
    });
  }, [wallet]);

  const clearError = useCallback(() => setError(null), []);

  const connect = useCallback(async (walletId: string = "phantom") => {
    setConnecting(true);
    setError(null);
    refreshWallets();
    logWalletProviderDiagnostics(`connect.start:${walletId}`);

    try {
      const preferred = getPreferredWalletAdapter(walletId);
      if (!preferred || preferred.detect() !== "installed") {
        throw new WalletError(
          "not_installed",
          "Phantom is not installed. Install the Phantom extension, then try again.",
        );
      }

      const connected = await preferred.connect({ onlyIfTrusted: false });
      if (!connected.publicKey) {
        throw new WalletError(
          "failed",
          "Could not connect Phantom. Please try again.",
        );
      }
      setWallet(connected);
      setError(null);
      logConnectedWalletDiagnostics(connected, "connect.success");
    } catch (err) {
      setWallet(null);
      setError(toPublicWalletMessage(err));
      logConnectedWalletDiagnostics(null, "connect.failed");
      throw err;
    } finally {
      setConnecting(false);
      refreshWallets();
    }
  }, [refreshWallets]);

  const disconnect = useCallback(async () => {
    setError(null);
    if (wallet) {
      const adapter = getWalletAdapter(wallet.id);
      await adapter?.disconnect();
    }
    setWallet(null);
  }, [wallet]);

  const value = useMemo(
    () => ({
      wallet,
      connecting,
      error,
      wallets,
      connect,
      disconnect,
      clearError,
    }),
    [wallet, connecting, error, wallets, connect, disconnect, clearError],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
