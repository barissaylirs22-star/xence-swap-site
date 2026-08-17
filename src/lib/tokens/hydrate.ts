import { looksLikeMintAddress } from "./catalog";
import { JupiterTokenDiscovery } from "./jupiter/discovery";
import { resolveMintOnChain } from "./onchain";
import type { TokenAsset } from "./types";

const remote = new JupiterTokenDiscovery();

async function fetchMetadataFromUri(
  uri: string,
  signal?: AbortSignal,
): Promise<{ name?: string; symbol?: string; image?: string } | null> {
  if (!uri.startsWith("http://") && !uri.startsWith("https://")) return null;
  try {
    const res = await fetch(uri, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      name?: unknown;
      symbol?: unknown;
      image?: unknown;
    };
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      symbol: typeof data.symbol === "string" ? data.symbol : undefined,
      image: typeof data.image === "string" ? data.image : undefined,
    };
  } catch {
    return null;
  }
}

function mergeToken(base: TokenAsset, patch: Partial<TokenAsset>): TokenAsset {
  const warnings = Array.from(
    new Set([...(base.warnings ?? []), ...(patch.warnings ?? [])]),
  );
  return {
    ...base,
    ...patch,
    iconUrl: patch.iconUrl ?? base.iconUrl ?? null,
    symbol: patch.symbol || base.symbol,
    name: patch.name || base.name,
    decimals: patch.decimals ?? base.decimals,
    warnings: warnings.length ? warnings : base.warnings,
  };
}

/**
 * Hydrate discovery tokens for quoting/display.
 * Fail soft — never throw into the swap UI.
 */
export async function hydrateTokenForSwap(
  token: TokenAsset,
  signal?: AbortSignal,
): Promise<TokenAsset> {
  if (!token.mint || !looksLikeMintAddress(token.mint)) {
    return { ...token, selectable: false };
  }

  let next: TokenAsset = { ...token };

  const needsDecimals = next.decimals === null;
  const needsMeta =
    !next.iconUrl ||
    !next.name ||
    next.name === "Unknown token" ||
    !next.symbol;

  try {
    if (needsDecimals || needsMeta) {
      const found = await remote.getByMint(next.mint, signal);
      if (found) {
        next = mergeToken(next, {
          decimals: found.decimals ?? next.decimals,
          symbol: found.symbol,
          name: found.name,
          iconUrl: found.iconUrl,
          verified: found.verified ?? next.verified,
          warnings: found.warnings,
        });
      }
    }

    if (next.decimals === null) {
      const onchain = await resolveMintOnChain(next.mint, signal);
      if (onchain?.decimals != null) {
        next = mergeToken(next, {
          decimals: onchain.decimals,
          warnings: onchain.warnings,
        });
      }
    }

    // Pump.fun / discovery URIs often carry logo + name when indexes lag.
    if (
      (!next.iconUrl || next.name === "Unknown token") &&
      next.metadataUri
    ) {
      const meta = await fetchMetadataFromUri(next.metadataUri, signal);
      if (meta) {
        next = mergeToken(next, {
          name: meta.name,
          symbol: meta.symbol,
          iconUrl: meta.image ?? next.iconUrl,
        });
      }
    }
  } catch {
    /* keep best-effort token */
  }

  return next;
}
