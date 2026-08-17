/**
 * Node file-backed store for Holder Intelligence (Vite dev/preview).
 * Shared across all browsers hitting this machine — not localStorage.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MAX_MINTS,
  pruneMintSeries,
} from "./core.mjs";

/**
 * @param {string} dataDir absolute path to .data/holder-intel
 */
export function createFileStore(dataDir) {
  const storePath = join(dataDir, "store.json");
  let writeChain = Promise.resolve();

  async function ensureDir() {
    await mkdir(dataDir, { recursive: true });
  }

  async function readRaw() {
    try {
      const raw = await readFile(storePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || typeof parsed.mints !== "object") {
        return { v: 1, mints: {} };
      }
      return parsed;
    } catch (err) {
      if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
        return { v: 1, mints: {} };
      }
      console.warn("[holder-intel-store] read failed", err?.message ?? err);
      return { v: 1, mints: {} };
    }
  }

  async function writeRaw(store) {
    await ensureDir();
    const tmp = `${storePath}.${process.pid}.tmp`;
    const payload = JSON.stringify(store);
    await writeFile(tmp, payload, "utf8");
    await rename(tmp, storePath);
  }

  function pruneAll(store, now) {
    const entries = Object.entries(store.mints).map(([mint, series]) => {
      return [mint, pruneMintSeries(series, now)];
    });
    entries.sort((a, b) => {
      const aLast = a[1][a[1].length - 1]?.t ?? 0;
      const bLast = b[1][b[1].length - 1]?.t ?? 0;
      return bLast - aLast;
    });
    const mints = {};
    for (const [mint, series] of entries.slice(0, MAX_MINTS)) {
      if (series.length) mints[mint] = series;
    }
    return { v: 1, mints };
  }

  return {
    async getSeries(mint) {
      const store = await readRaw();
      const now = Date.now();
      return pruneMintSeries(store.mints[mint] ?? [], now);
    },

    /**
     * Mutate one mint series under a simple write queue (avoids lost updates).
     * @param {string} mint
     * @param {(series: any[], now: number) => { series: any[], meta?: object }} mutator
     */
    async updateSeries(mint, mutator) {
      const run = writeChain.then(async () => {
        const now = Date.now();
        const store = pruneAll(await readRaw(), now);
        const current = store.mints[mint] ?? [];
        const result = mutator(current, now);
        store.mints[mint] = result.series;
        const next = pruneAll(store, now);
        await writeRaw(next);
        return {
          series: next.mints[mint] ?? result.series,
          meta: result.meta ?? {},
        };
      });
      writeChain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },

    /** Test / admin helper */
    async clearAll() {
      await writeRaw({ v: 1, mints: {} });
    },

    async dump() {
      return pruneAll(await readRaw(), Date.now());
    },

    storePath,
  };
}
