import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { holdersRpcProxyPlugin } from "./vite/holdersRpcProxy";
import { holderIntelProxyPlugin } from "./vite/holderIntelProxy";

export default defineConfig(({ mode }) => {
  // Load all env keys (including non-VITE_) for the server-side holders proxy.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      react(),
      holdersRpcProxyPlugin(env),
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
