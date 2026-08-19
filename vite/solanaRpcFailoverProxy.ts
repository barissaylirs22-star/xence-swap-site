import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  SOLANA_RPC_PROXY_PATH,
  STANDARD_RPC_ALLOWED_METHODS,
  forwardStandardRpcWithFailover,
  resolveStandardRpcFallback,
  resolveStandardRpcPrimary,
  safeRpcErrorMessage,
} from "../server/solanaRpcFailover.mjs";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

/**
 * Same-origin standard Solana JSON-RPC proxy with Provider B failover.
 * Keeps SOLANA_RPC_FALLBACK_URL off the client bundle.
 */
export function solanaRpcFailoverProxyPlugin(
  env: Record<string, string>,
): Plugin {
  const primaryUrl = resolveStandardRpcPrimary(env);
  const fallbackUrl = resolveStandardRpcFallback(env);
  /** Local proof counter — increments only when Provider B is used. */
  let fallbackUsed = 0;

  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const url = req.url?.split("?")[0] ?? "";
    if (url !== SOLANA_RPC_PROXY_PATH) {
      next();
      return;
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.end();
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        fallbackConfigured: Boolean(fallbackUrl),
        fallbackUsed,
      });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    try {
      const raw = await readBody(req);
      let method = "unknown";
      try {
        method =
          (JSON.parse(raw || "{}") as { method?: string }).method ?? "unknown";
      } catch {
        // ignore
      }

      if (!STANDARD_RPC_ALLOWED_METHODS.has(method)) {
        sendJson(res, 403, {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32601,
            message: `Method not allowed on standard RPC proxy: ${method}`,
          },
        });
        return;
      }

      const result = await forwardStandardRpcWithFailover({
        body: raw || "{}",
        primaryUrl,
        fallbackUrl,
      });

      if (result.used === "fallback") {
        fallbackUsed += 1;
        console.warn("[solana-rpc-proxy]", {
          method,
          used: "fallback",
          http: result.status,
        });
      }

      res.statusCode = result.status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Axiom-Rpc-Upstream", result.used);
      res.setHeader(
        "X-Axiom-Rpc-Fallback-Attempted",
        result.fallbackAttempted ? "1" : "0",
      );
      res.end(result.text);
    } catch (error) {
      console.warn("[solana-rpc-proxy]", {
        error: safeRpcErrorMessage(error),
      });
      sendJson(res, 502, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32002,
          message: "Standard Solana RPC proxy failed",
        },
      });
    }
  };

  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(middleware);
  };

  return {
    name: "axiom-solana-rpc-failover-proxy",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
