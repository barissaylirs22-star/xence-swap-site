import { SOL_MINT } from "@/lib/tokens/catalog";
import { hydrateTokenForSwap } from "@/lib/tokens/hydrate";
import type { TokenAsset } from "@/lib/tokens/types";
import { withAxiomScore } from "./axiomScore";
import { buildHolderIntelV2 } from "./holderHistory";
import { fetchHolderConcentration } from "./holders";
import { loadMarketFacts } from "./market";
import { fetchMintSecuritySnapshot } from "./onchain";
import { RISK_VERY_LOW_LIQUIDITY_USD, RISK_VERY_NEW_MS } from "./risk";
import { probeJupiterRoute } from "./route";
import type {
  IntelligenceSource,
  LoadTokenIntelligenceOptions,
  TokenIntelligence,
  TokenSecurityFacts,
  TokenTradingFacts,
} from "./types";
import { fetchWhaleActivity } from "./whaleActivity";

function emptySecurity(pendingHolders: boolean): TokenSecurityFacts {
  return {
    mintAuthorityActive: null,
    freezeAuthorityActive: null,
    mintAuthority: null,
    freezeAuthority: null,
    supplyUi: null,
    decimals: null,
    holderCount: null,
    topHolderPct: null,
    top10HolderPct: null,
    authoritiesAvailable: false,
    holdersAvailable: false,
    holdersPending: pendingHolders,
    holdersStatus: pendingHolders ? "pending" : "idle",
    holdersError: null,
  };
}

/**
 * Build normalized Token Intelligence V1 for a selected discovery/swap token.
 * Core market + mint security + route probe load together.
 * Holder concentration is optional and never blocks the core result.
 */
export async function loadTokenIntelligence(
  input: TokenAsset,
  options: LoadTokenIntelligenceOptions = {},
): Promise<TokenIntelligence> {
  const includeHolders = options.includeHolders !== false;
  const signal = options.signal;
  const sources: IntelligenceSource[] = ["token_asset"];

  const hydrated = await hydrateTokenForSwap(input, signal);
  sources.push("hydrate");

  const isNativeSol =
    hydrated.isNativeSol === true || hydrated.mint === SOL_MINT;

  const [market, mintSnap, route] = await Promise.all([
    loadMarketFacts(hydrated, signal),
    isNativeSol
      ? Promise.resolve(null)
      : fetchMintSecuritySnapshot(hydrated.mint, signal),
    probeJupiterRoute(hydrated.mint, signal),
  ]);

  if (market.available) sources.push("dexscreener");
  if (mintSnap) sources.push("solana_rpc");
  if (route) sources.push("jupiter_quote");

  let security = emptySecurity(!isNativeSol);
  if (isNativeSol) {
    security = {
      ...emptySecurity(false),
      mintAuthorityActive: false,
      freezeAuthorityActive: false,
      decimals: hydrated.decimals ?? 9,
      authoritiesAvailable: true,
      holdersPending: false,
    };
  } else if (mintSnap) {
    security = {
      ...security,
      mintAuthorityActive: mintSnap.mintAuthorityActive,
      freezeAuthorityActive: mintSnap.freezeAuthorityActive,
      mintAuthority: mintSnap.mintAuthority,
      freezeAuthority: mintSnap.freezeAuthority,
      supplyUi: mintSnap.supplyUi,
      decimals: mintSnap.decimals ?? hydrated.decimals,
      authoritiesAvailable: true,
    };
  } else if (hydrated.decimals != null) {
    security = {
      ...security,
      decimals: hydrated.decimals,
    };
  }

  const liquidityWarning =
    market.liquidityUsd != null &&
    market.liquidityUsd < RISK_VERY_LOW_LIQUIDITY_USD;

  const veryNewTokenWarning =
    market.ageMs != null && market.ageMs < RISK_VERY_NEW_MS;

  const trading: TokenTradingFacts = {
    routeAvailable: route?.routeAvailable ?? null,
    priceImpactPct: route?.priceImpactPct ?? null,
    priceImpactLevel: route?.priceImpactLevel ?? "unknown",
    liquidityWarning,
    veryNewTokenWarning,
  };

  let intel: TokenIntelligence = {
    mint: hydrated.mint,
    identity: {
      name: hydrated.name,
      symbol: hydrated.symbol,
      mint: hydrated.mint,
      imageUrl: hydrated.iconUrl ?? null,
      decimals: security.decimals ?? hydrated.decimals,
    },
    market,
    security,
    trading,
    risk: {
      level: "UNKNOWN",
      reasons: [],
      assessedAt: Date.now(),
    },
    axiomScore: null,
    holderIntel: null,
    whaleActivity: null,
    token: {
      ...hydrated,
      decimals: security.decimals ?? hydrated.decimals,
      priceUsd: market.priceUsd,
      marketCapUsd: market.marketCapUsd,
      fdvUsd: market.fdvUsd,
      liquidityUsd: market.liquidityUsd,
      priceChange5mPct: market.priceChange5mPct,
      priceChange1hPct: market.priceChange1hPct,
      priceChange24hPct: market.priceChange24hPct,
      volume24hUsd: market.volume24hUsd,
      listedAt: market.listedAt,
    },
    sources,
    partial: true,
    updatedAt: Date.now(),
  };
  intel = withAxiomScore(intel, isNativeSol);

  if (includeHolders && !isNativeSol) {
    intel = await enrichTokenIntelligenceHolders(intel, signal);
  } else {
    intel.partial =
      !market.available ||
      (!isNativeSol && !mintSnap) ||
      route === null;
  }

  return intel;
}

/**
 * Enrich an existing intelligence object with holder concentration.
 * Safe to call after first paint — does not block core fields.
 * Always settles holdersStatus (never leaves pending after return).
 */
export async function enrichTokenIntelligenceHolders(
  intel: TokenIntelligence,
  signal?: AbortSignal,
): Promise<TokenIntelligence> {
  if (intel.mint === SOL_MINT || intel.token.isNativeSol) {
    const security: TokenSecurityFacts = {
      ...intel.security,
      holdersPending: false,
      holdersStatus: "idle",
      holdersAvailable: false,
      holdersError: null,
      holderCount: null,
      topHolderPct: null,
      top10HolderPct: null,
    };
    return withAxiomScore(
      {
        ...intel,
        security,
        holderIntel: null,
        whaleActivity: null,
        partial: isPartial({ ...intel, security }, false),
      },
      true,
    );
  }

  const holders = await fetchHolderConcentration(intel.mint, null, signal);

  const sources: IntelligenceSource[] = [...intel.sources];
  if (!sources.includes("holders_rpc")) {
    sources.push("holders_rpc");
  }

  const concentrationOk =
    holders.status === "ok" &&
    (holders.topHolderPct != null || holders.top10HolderPct != null);

  const holdersStatus =
    holders.status === "ok"
      ? concentrationOk
        ? "ready"
        : "unavailable"
      : holders.status === "unavailable"
        ? "unavailable"
        : "error";

  const security: TokenSecurityFacts = {
    ...intel.security,
    holderCount:
      holders.holderCount != null && Number.isFinite(holders.holderCount)
        ? holders.holderCount
        : null,
    topHolderPct: concentrationOk ? holders.topHolderPct : null,
    top10HolderPct: concentrationOk ? holders.top10HolderPct : null,
    holdersAvailable: concentrationOk,
    holdersPending: false,
    holdersStatus,
    holdersError: concentrationOk ? null : (holders.errorMessage ?? null),
  };

  const holderIntel = await buildHolderIntelV2(
    intel.mint,
    {
      holderCount: security.holderCount,
      topHolderPct: security.topHolderPct,
      top10HolderPct: security.top10HolderPct,
      priceUsd: intel.market.priceUsd,
      liquidityUsd: intel.market.liquidityUsd,
      marketCapUsd: intel.market.marketCapUsd ?? intel.market.fdvUsd ?? null,
    },
    signal,
  );

  const next: TokenIntelligence = withAxiomScore(
    {
      ...intel,
      security,
      holderIntel,
      whaleActivity: intel.whaleActivity ?? null,
      sources,
      partial: isPartial({ ...intel, security }, !concentrationOk),
      updatedAt: Date.now(),
    },
    false,
  );

  return next;
}

/**
 * Token Detail only — recent large-holder on-chain activity.
 * Does not block holder concentration; call after holders settle.
 */
export async function enrichTokenIntelligenceWhale(
  intel: TokenIntelligence,
  signal?: AbortSignal,
): Promise<TokenIntelligence> {
  if (intel.mint === SOL_MINT || intel.token.isNativeSol) {
    return {
      ...intel,
      whaleActivity: {
        status: "unavailable",
        events: [],
        smartMoneyAvailable: false,
        analyzedAccounts: 0,
        updatedAt: Date.now(),
        errorMessage: null,
      },
    };
  }

  const whaleActivity = await fetchWhaleActivity(intel.mint, {
    priceUsd: intel.market.priceUsd,
    liquidityUsd: intel.market.liquidityUsd,
    marketCapUsd: intel.market.marketCapUsd,
    signal,
  });

  const sources: IntelligenceSource[] = [...intel.sources];
  if (!sources.includes("whale_activity")) {
    sources.push("whale_activity");
  }

  return withAxiomScore(
    {
      ...intel,
      whaleActivity,
      sources,
      updatedAt: Date.now(),
    },
    false,
  );
}

function isPartial(
  intel: TokenIntelligence,
  holdersIncomplete: boolean,
): boolean {
  return (
    !intel.market.available ||
    !intel.security.authoritiesAvailable ||
    intel.trading.routeAvailable === null ||
    intel.security.holdersPending ||
    holdersIncomplete
  );
}
