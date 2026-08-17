import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import App from "./App";
import "./styles/global.css";

// Prevent the browser from restoring a mid-page scroll on bare "/".
if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}
if (!window.location.hash || window.location.hash === "#") {
  window.scrollTo(0, 0);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnReconnect: true,
    },
  },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <App />
      </WalletProvider>
    </QueryClientProvider>
  </StrictMode>,
);
