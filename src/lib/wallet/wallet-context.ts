import { createContext } from "react";
import type { ConnectedWallet, WalletDescriptor } from "./types";

export interface WalletContextValue {
  wallet: ConnectedWallet | null;
  connecting: boolean;
  error: string | null;
  wallets: WalletDescriptor[];
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  clearError: () => void;
}

export const WalletContext = createContext<WalletContextValue | null>(null);
