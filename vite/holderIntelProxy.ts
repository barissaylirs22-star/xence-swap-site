import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const HOLDER_INTEL_API_PATH = "/api/holder-intel";

type HolderIntelHandle = (input: {
  method: string;
  bodyText?: string;
  mintQuery?: string | null;
  clientId?: string;
}) => Promise<{ status: number; body: unknown }>;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function clientId(req: IncomingMessage): string {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "local";
}

/**
 * Same-origin Holder Intelligence history API.
 * Persists real observations to a server-side JSON file store (not localStorage).
 */
export function holderIntelProxyPlugin(env: Record<string, string>): Plugin {
  const dataDir = resolve(
    process.cwd(),
    (env.HOLDER_INTEL_DATA_DIR ?? ".data/holder-intel").trim() ||
      ".data/holder-intel",
  );
  const allowBackdate =
    (env.HOLDER_INTEL_ALLOW_BACKDATE ?? "").trim() === "1";

  let handlePromise: Promise<HolderIntelHandle> | null = null;

  const getHandle = (): Promise<HolderIntelHandle> => {
    if (!handlePromise) {
      handlePromise = (async () => {
        const fileStoreUrl = pathToFileURL(
          resolve(process.cwd(), "server/holderIntel/fileStore.mjs"),
        ).href;
        const apiUrl = pathToFileURL(
          resolve(process.cwd(), "server/holderIntel/api.mjs"),
        ).href;
        const { createFileStore } = await import(
          /* @vite-ignore */ fileStoreUrl
        );
        const { createHolderIntelHandler } = await import(
          /* @vite-ignore */ apiUrl
        );
        const store = createFileStore(dataDir);
        const { handle } = createHolderIntelHandler(store, { allowBackdate });
        return handle as HolderIntelHandle;
      })();
    }
    return handlePromise;
  };

  const middleware = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const rawUrl = req.url ?? "";
    const pathOnly = rawUrl.split("?")[0] ?? "";
    if (pathOnly !== HOLDER_INTEL_API_PATH) {
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

    try {
      const handle = await getHandle();
      const url = new URL(rawUrl, "http://localhost");
      const bodyText =
        req.method === "POST" || req.method === "PUT"
          ? await readBody(req)
          : "";
      const result = await handle({
        method: req.method ?? "GET",
        bodyText,
        mintQuery: url.searchParams.get("mint"),
        clientId: clientId(req),
      });
      sendJson(res, result.status, result.body);
    } catch (error) {
      console.warn("[holder-intel]", {
        error: error instanceof Error ? error.message : "handler failed",
      });
      sendJson(res, 500, { error: "Holder intel store failed" });
    }
  };

  const attach = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(middleware);
  };

  return {
    name: "axiom-holder-intel-proxy",
    configureServer(server) {
      console.info(`[holder-intel] file store → ${dataDir}`);
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
