import type { TokenAsset } from "@/lib/tokens/types";
import type { IntelPriceImpactLevel } from "./impact";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export type RiskReasonCode =
  | "mint_authority_active"
  | "freeze_authority_active"
  | "very_low_liquidity"
  | "volume_liquidity_mismatch"
  | "very_new_token"
  | "high_holder_concentration"
  | "high_top10_concentration"
  | "no_jupiter_route"
  | "moderate_price_impact"
  | "elevated_price_impact"
  | "high_price_impact"
  | "holders_analysis_pending"
  | "holders_data_unavailable"
  | "holders_falling_rapidly"
  | "largest_holder_share_rising"
  | "top10_concentration_rising"
  | "holders_falling_concentration_rising"
  | "major_holder_distribution"
  | "large_confirmed_sell_major_holder"
  | "large_supply_moved"
  | "insufficient_data";

export interface RiskReason {
  code: RiskReasonCode;
  message: string;
}

export interface TokenIdentityFacts {
  name: string;
  symbol: string;
  mint: string;
  imageUrl: string | null;
  decimals: number | null;
}

export interface TokenMarketFacts {
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  priceChange5mPct: number | null;
  priceChange1hPct: number | null;
  priceChange24hPct: number | null;
  volume24hUsd: number | null;
  /** Pair / listing time (epoch ms) when Dex provides it. */
  listedAt: number | null;
  /** Age in ms derived from listedAt when available. */
  ageMs: number | null;
  available: boolean;
}

/** Holder enrichment lifecycle for Token Detail (never invents census). */
export type HolderFetchStatus = "ok" | "unavailable" | "error";

export type HoldersUiStatus =
  | "idle"
  | "pending"
  | "ready"
  | "unavailable"
  | "error";

export interface HolderConcentrationSnapshot {
  status: HolderFetchStatus;
  /**
   * Unique non-zero owners from Helius DAS getTokenAccounts census when complete.
   * Null when census incomplete/unavailable — never estimated.
   */
  holderCount: number | null;
  topHolderPct: number | null;
  top10HolderPct: number | null;
  accountsSampled: number;
  updatedAt: number;
  errorMessage?: string;
}

export interface TokenSecurityFacts {
  /** true = authority set; false = revoked/null; null = unknown */
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supplyUi: number | null;
  decimals: number | null;
  /**
   * Total holder count — only when a reliable source exists.
   * Top-N RPC largest-accounts alone is NOT treated as holder count.
   */
  holderCount: number | null;
  /** Largest token account share of supply (0–100), when known. */
  topHolderPct: number | null;
  /** Sum of top-10 token account shares (0–100), when known. */
  top10HolderPct: number | null;
  authoritiesAvailable: boolean;
  holdersAvailable: boolean;
  holdersPending: boolean;
  /** Explicit holder section state for UI (never stuck pending after settle). */
  holdersStatus: HoldersUiStatus;
  /** Last holder enrichment error / limitation (display / diagnostics). */
  holdersError: string | null;
}

/** Holder Intelligence V2 — growth + whale movement from Axiom snapshots. */
export type HolderHistoryWindow = "5m" | "1h" | "6h" | "24h";

export interface HolderGrowthDelta {
  window: HolderHistoryWindow;
  absolute: number;
  percent: number;
  fromAt: number;
  fromCount: number;
  toCount: number;
  line: string;
  detailLine: string;
}

export type ConcentrationTrend = "increasing" | "decreasing" | "stable";

export interface HolderGrowthFacts {
  available: boolean;
  building: boolean;
  currentCount: number | null;
  deltas: HolderGrowthDelta[];
  primaryLine: string | null;
  recordedMs: number | null;
  statusLine: string | null;
}

export interface ConcentrationWindowDelta {
  window: HolderHistoryWindow;
  largestFrom: number | null;
  largestTo: number | null;
  largestDeltaPp: number | null;
  top10From: number | null;
  top10To: number | null;
  top10DeltaPp: number | null;
  fromAt: number;
  largestLine: string | null;
  top10Line: string | null;
}

export interface WhaleMovementFacts {
  available: boolean;
  building: boolean;
  largestTrend: ConcentrationTrend | null;
  top10Trend: ConcentrationTrend | null;
  largestDeltaPp: number | null;
  top10DeltaPp: number | null;
  comparedAt: number | null;
  preferredWindow: HolderHistoryWindow | null;
  windows: ConcentrationWindowDelta[];
  signals: string[];
  recordedMs: number | null;
  statusLine: string | null;
}

export interface HolderIntelV2Facts {
  growth: HolderGrowthFacts;
  whale: WhaleMovementFacts;
  interpretations: string[];
  recordedMs: number | null;
  snapshotCount: number;
  lastSnapshotAt: number | null;
}

/** On-chain whale / large-holder activity (Token Detail only). */
export type WhaleEventKind =
  | "confirmed_buy"
  | "confirmed_sell"
  | "large_transfer"
  | "balance_increase"
  | "balance_decrease"
  | "accumulation"
  | "distribution"
  | "top_holder_transfer"
  | "holder_movement";

export interface WhaleActivityEvent {
  /** Primary signature (first in the aggregation window). */
  signature: string;
  /** All underlying transaction signatures (evidence; may be length 1). */
  signatures: string[];
  observedAt: number;
  firstObservedAt: number;
  lastObservedAt: number;
  kind: WhaleEventKind;
  summary: string;
  line: string;
  ageLabel: string;
  wallet: string;
  walletShort: string;
  supplyPct: number;
  tokenAmountUi: number | null;
  /** Display / score USD magnitude (abs net for swap aggregates when known). */
  usdValue: number | null;
  /** Gross confirmed BUY USD inside the aggregation window. */
  buyUsd: number;
  /** Gross confirmed SELL USD inside the aggregation window. */
  sellUsd: number;
  /** buyUsd − sellUsd (null when no swap USD was available). */
  netUsd: number | null;
  buyCount: number;
  sellCount: number;
  /** Non-swap transfer / balance moves in this aggregate. */
  transferCount: number;
  /** True when more than one underlying transaction was merged. */
  aggregated: boolean;
  isTopHolder: boolean;
  isTop10Holder: boolean;
  isSwap: boolean;
  major: boolean;
  /** True when event may influence Risk Analysis (stricter than display significance). */
  riskRelevant: boolean;
  rank: number;
}

export interface WhaleActivityFacts {
  status: "ready" | "unavailable" | "pending";
  events: WhaleActivityEvent[];
  /** Always false in V1 — wallet performance not scored. */
  smartMoneyAvailable: boolean;
  analyzedAccounts: number;
  updatedAt: number;
  errorMessage: string | null;
}

export interface TokenTradingFacts {
  /** null = not probed / gated / unknown */
  routeAvailable: boolean | null;
  priceImpactPct: number | null;
  /** TI-specific levels — aligned with Risk V1 + explainability. */
  priceImpactLevel: IntelPriceImpactLevel;
  liquidityWarning: boolean;
  veryNewTokenWarning: boolean;
}

export interface TokenRiskAssessment {
  level: RiskLevel;
  reasons: RiskReason[];
  assessedAt: number;
}

export type AxiomScoreBand =
  | "strong_structure"
  | "healthy"
  | "caution"
  | "high_risk"
  | "extreme_risk";

export type AxiomDataConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface AxiomScoreFactor {
  code: string;
  message: string;
  tone: "positive" | "warning";
  weight: number;
}

export interface AxiomScoreCategory {
  id:
    | "security"
    | "holders"
    | "liquidity"
    | "holderTrend"
    | "whale";
  label: string;
  max: number;
  points: number;
  neutralMissing: boolean;
}

export interface AxiomScoreResult {
  score: number;
  band: AxiomScoreBand;
  label: string;
  confidence: AxiomDataConfidence;
  categories: AxiomScoreCategory[];
  positives: AxiomScoreFactor[];
  warnings: AxiomScoreFactor[];
  mappedRiskLevel: RiskLevel;
  criticalOverride: boolean;
  criticalOverrideReason: string | null;
  computedAt: number;
}

export type IntelligenceSource =
  | "token_asset"
  | "hydrate"
  | "dexscreener"
  | "solana_rpc"
  | "jupiter_quote"
  | "holders_rpc"
  | "whale_activity";

/**
 * Normalized Token Intelligence V1 payload.
 * Safe for a future Token Detail UI — not used for swap execution decisions.
 */
export interface TokenIntelligence {
  mint: string;
  identity: TokenIdentityFacts;
  market: TokenMarketFacts;
  security: TokenSecurityFacts;
  trading: TokenTradingFacts;
  risk: TokenRiskAssessment;
  /** Explainable 0–100 structural score (Token Detail; lite path for discovery later). */
  axiomScore: AxiomScoreResult | null;
  /** Holder growth + whale movement from Axiom observations (V2). */
  holderIntel: HolderIntelV2Facts | null;
  /** Recent large-holder on-chain activity (Token Detail only). */
  whaleActivity: WhaleActivityFacts | null;
  /** Best-effort hydrated token for display / selection continuity. */
  token: TokenAsset;
  sources: IntelligenceSource[];
  partial: boolean;
  updatedAt: number;
}

export interface LoadTokenIntelligenceOptions {
  signal?: AbortSignal;
  /**
   * When true (default), holder concentration loads after core facts.
   * Core identity/market/security/route never waits on holders.
   */
  includeHolders?: boolean;
}
