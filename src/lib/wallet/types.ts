import type { VersionedTransaction } from "@solana/web3.js";

export type WalletReadyState = "installed" | "not_found" | "unsupported";

export interface WalletDescriptor {
  id: string;
  name: string;
  readyState: WalletReadyState;
}

export interface ConnectedWallet {
  id: string;
  name: string;
  publicKey: string;
  signTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  signAndSendTransaction?: (tx: VersionedTransaction) => Promise<string>;
}

export interface WalletAdapter {
  id: string;
  name: string;
  detect(): WalletReadyState;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<ConnectedWallet>;
  disconnect(): Promise<void>;
  /** Subscribe to provider account/disconnect changes. Returns unsubscribe. */
  subscribe?(handlers: {
    onAccountChange?: (publicKey: string | null) => void;
    onDisconnect?: () => void;
  }): () => void;
}
