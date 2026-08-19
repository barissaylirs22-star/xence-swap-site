import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { holdersRpcProxyPlugin } from "./vite/holdersRpcProxy";
import { holderIntelProxyPlugin } from "./vite/holderIntelProxy";
import { solanaRpcFailoverProxyPlugin } from "./vite/solanaRpcFailoverProxy";

export default defineConfig(({ mode }) => {
  // Load all env keys (including non-VITE_) for server-side RPC proxies.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      holdersRpcProxyPlugin(env),
      solanaRpcFailoverProxyPlugin(env),
      holderIntelProxyPlugin(env),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
      assetsInlineLimit: 4096,
    },
  };
});
