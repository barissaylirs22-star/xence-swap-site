import { useContext } from "react";
import { WalletContext, type WalletContextValue } from "./wallet-context";

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within WalletProvider");
  }
  return ctx;
}
