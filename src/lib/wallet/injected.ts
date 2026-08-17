import type { VersionedTransaction } from "@solana/web3.js";
import { WalletError, isUserRejection, isWalletLocked } from "./errors";
import type {
  ConnectedWallet,
  WalletAdapter,
  WalletReadyState,
} from "./types";

interface InjectedProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  publicKey?: unknown;
  isConnected?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{
    publicKey?: unknown;
  }>;
  disconnect: () => Promise<void>;
  signTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  signAndSendTransaction?: (
    tx: VersionedTransaction,
    opts?: unknown,
  ) => Promise<{ signature: string } | string>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    handler: (...args: unknown[]) => void,
  ) => void;
}

declare global {
  interface Window {
    solana?: InjectedProvider;
    phantom?: { solana?: InjectedProvider };
    solflare?: InjectedProvider;
    backpack?: { solana?: InjectedProvider };
  }
}

function publicKeyToBase58(pk: unknown): string {
  if (typeof pk === "string" && pk.length > 0) return pk;
  if (pk && typeof pk === "object") {
    const obj = pk as { toBase58?: () => string; toString?: () => string };
    if (typeof obj.toBase58 === "function") {
      const value = obj.toBase58();
      if (value) return value;
    }
    if (typeof obj.toString === "function") {
      const value = obj.toString();
      if (value && value !== "[object Object]") return value;
    }
  }
  throw new WalletError("failed", "Could not read wallet address.");
}

function wrapConnected(
  id: string,
  name: string,
  publicKey: string,
  provider: InjectedProvider,
): ConnectedWallet {
  return {
    id,
    name,
    publicKey,
    signTransaction: provider.signTransaction
      ? (tx) => provider.signTransaction!(tx)
      : undefined,
    signAndSendTransaction: provider.signAndSendTransaction
      ? async (tx) => {
          const result = await provider.signAndSendTransaction!(tx);
          return typeof result === "string" ? result : result.signature;
        }
      : undefined,
  };
}

/**
 * Resolve Phantom's Solana provider only.
 * Never use window.ethereum / EVM providers.
 */
function resolvePhantomProvider(): InjectedProvider | undefined {
  if (typeof window === "undefined") return undefined;

  // Preferred modern injection path.
  const fromNamespace = window.phantom?.solana;
  if (fromNamespace?.isPhantom) return fromNamespace;

  // Legacy path — only accept when explicitly marked Phantom Solana.
  if (window.solana?.isPhantom) return window.solana;

  return undefined;
}

function createInjectedAdapter(
  id: string,
  name: string,
  resolve: () => InjectedProvider | undefined,
  notInstalledMessage: string,
): WalletAdapter {
  return {
    id,
    name,
    detect(): WalletReadyState {
      if (typeof window === "undefined") return "unsupported";
      return resolve() ? "installed" : "not_found";
    },
    async connect(options?: {
      onlyIfTrusted?: boolean;
    }): Promise<ConnectedWallet> {
      const provider = resolve();
      if (!provider) {
        throw new WalletError("not_installed", notInstalledMessage);
      }

      try {
        const result = await provider.connect({
          onlyIfTrusted: options?.onlyIfTrusted === true,
        });
        const pk = result?.publicKey ?? provider.publicKey;
        if (!pk) {
          throw new WalletError(
            "failed",
            `Could not connect ${name}. Please try again.`,
          );
        }
        const publicKey = publicKeyToBase58(pk);
        // Ensure provider.publicKey is populated after connect for session restore.
        if (!provider.publicKey) {
          provider.publicKey = pk;
        }
        return wrapConnected(id, name, publicKey, provider);
      } catch (cause) {
        if (cause instanceof WalletError) throw cause;
        if (isUserRejection(cause)) {
          throw new WalletError("rejected", "Connection cancelled.", cause);
        }
        if (isWalletLocked(cause)) {
          throw new WalletError(
            "locked",
            "Phantom is locked. Unlock it, then try again.",
            cause,
          );
        }
        throw new WalletError(
          "failed",
          `Could not connect ${name}. Please try again.`,
          cause,
        );
      }
    },
    async disconnect(): Promise<void> {
      const provider = resolve();
      try {
        await provider?.disconnect?.();
      } catch {
        /* ignore provider disconnect errors */
      }
    },
    subscribe(handlers) {
      const provider = resolve();
      if (!provider?.on) return () => undefined;

      const onAccount = (...args: unknown[]) => {
        const pk = args[0];
        if (!pk) {
          handlers.onAccountChange?.(null);
          return;
        }
        try {
          handlers.onAccountChange?.(publicKeyToBase58(pk));
        } catch {
          handlers.onAccountChange?.(null);
        }
      };
      const onDisconnect = () => handlers.onDisconnect?.();

      provider.on("accountChanged", onAccount);
      provider.on("disconnect", onDisconnect);

      return () => {
        provider.off?.("accountChanged", onAccount);
        provider.off?.("disconnect", onDisconnect);
        provider.removeListener?.("accountChanged", onAccount);
        provider.removeListener?.("disconnect", onDisconnect);
      };
    },
  };
}

export const WALLET_ADAPTERS: WalletAdapter[] = [
  createInjectedAdapter(
    "phantom",
    "Phantom",
    resolvePhantomProvider,
    "Phantom is not installed. Install the Phantom extension, then try again.",
  ),
  createInjectedAdapter(
    "solflare",
    "Solflare",
    () => (typeof window !== "undefined" ? window.solflare : undefined),
    "Solflare is not installed.",
  ),
  createInjectedAdapter(
    "backpack",
    "Backpack",
    () =>
      typeof window !== "undefined" ? window.backpack?.solana : undefined,
    "Backpack is not installed.",
  ),
];

export function listWalletDescriptors(): {
  id: string;
  name: string;
  readyState: WalletReadyState;
}[] {
  return WALLET_ADAPTERS.map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    readyState: adapter.detect(),
  }));
}

export function getWalletAdapter(id: string): WalletAdapter | undefined {
  return WALLET_ADAPTERS.find((adapter) => adapter.id === id);
}

export function getPreferredWalletAdapter(
  walletId?: string,
): WalletAdapter | undefined {
  if (walletId) {
    const explicit = getWalletAdapter(walletId);
    if (explicit?.detect() === "installed") return explicit;
  }

  const phantom = getWalletAdapter("phantom");
  if (phantom?.detect() === "installed") return phantom;

  return WALLET_ADAPTERS.find((adapter) => adapter.detect() === "installed");
}
