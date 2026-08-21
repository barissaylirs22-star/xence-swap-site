export type {
  AxiomDataConfidence,
  AxiomScoreBand,
  AxiomScoreCategory,
  AxiomScoreFactor,
  AxiomScoreResult,
  ConcentrationTrend,
  HolderConcentrationSnapshot,
  HolderFetchStatus,
  HolderGrowthDelta,
  HolderGrowthFacts,
  HolderIntelV2Facts,
  HoldersUiStatus,
  IntelligenceSource,
  LoadTokenIntelligenceOptions,
  RiskLevel,
  RiskReason,
  RiskReasonCode,
  TokenIdentityFacts,
  TokenIntelligence,
  TokenMarketFacts,
  TokenRiskAssessment,
  TokenSecurityFacts,
  TokenTradingFacts,
  WhaleMovementFacts,
} from "./types";

export type {
  PositiveSignal,
  PositiveSignalCode,
  RiskDataConfidence,
  RiskExplanation,
} from "./explain";

export {
  assessTokenRisk,
  assessVolumeLiquidityMismatch,
  isMeaningfulHolderHistory,
  RISK_TOP10_EXTREME_PCT,
  RISK_TOP10_HIGH_PCT,
  RISK_TOP10_MEDIUM_PCT,
  RISK_TOP_HOLDER_EXTREME_PCT,
  RISK_TOP_HOLDER_HIGH_PCT,
  RISK_TOP_HOLDER_MEDIUM_PCT,
  RISK_VERY_LOW_LIQUIDITY_USD,
  RISK_VERY_NEW_MS,
  RISK_VOL_LIQ_LIQUIDITY_CAP_MEDIUM_USD,
  RISK_VOL_LIQ_LIQUIDITY_CAP_STRONG_USD,
  RISK_VOL_LIQ_RATIO_MEDIUM,
  RISK_VOL_LIQ_RATIO_STRONG,
} from "./risk";

export {
  AXIOM_SCORE_WEIGHTS,
  AXM_CONCENTRATION_CAP,
  AXM_SCORE_CAP,
  SCORE_DEADZONE,
  alignRiskWithAxiomScore,
  applyAxiomScoreGlobalCaps,
  classifyAxiomScore,
  computeAxiomScore,
  computeAxiomScoreLite,
  finalizeRiskAndScore,
  hasStrongWhaleDanger,
  hasUsableHolderConcentration,
  mapAxiomScoreToRiskLevel,
  withAxiomScore,
} from "./axiomScore";

export {
  assessRiskDataConfidence,
  buildPositiveSignals,
  explainTokenRisk,
  formatRiskSignalMessage,
  POSITIVE_HEALTHY_LIQUIDITY_USD,
  summarizeRiskAssessment,
} from "./explain";

export {
  enrichTokenIntelligenceHolders,
  enrichTokenIntelligenceWhale,
  loadTokenIntelligence,
} from "./build";

export {
  classifyIntelPriceImpact,
  INTEL_IMPACT_ELEVATED_MAX,
  INTEL_IMPACT_LOW_MAX,
  INTEL_IMPACT_MODERATE_MAX,
  normalizeIntelImpactPercent,
  resolveIntelPriceImpact,
} from "./impact";

export type { IntelPriceImpactLevel } from "./impact";

export { fetchMintSecuritySnapshot } from "./onchain";
export { fetchHolderConcentration } from "./holders";
export { probeJupiterRoute } from "./route";
export { loadMarketFacts } from "./market";

export {
  CONCENTRATION_MATERIAL_PP,
  CONCENTRATION_SEVERE_PP,
  CONCENTRATION_SHARP_PP,
  CONCENTRATION_SHORT_RISK_PP,
  CONCENTRATION_STABLE_MAX_PP,
  HOLDER_GROWTH_WINDOWS,
  HOLDERS_FALLING_ABS,
  HOLDERS_FALLING_PCT,
  HOLDERS_FALLING_SEVERE_PCT,
  HOLDERS_FALLING_SIGNIFICANT_PCT,
  HOLDER_INTEL_API_PATH,
  RISK_TREND_MIN_RECORDED_MS,
  RISK_TREND_MIN_SNAPSHOTS,
  SNAPSHOT_MIN_INTERVAL_MS,
  WINDOW_TOLERANCE,
  buildHolderIntelV2,
  fetchHolderIntelHistory,
  persistHolderObservation,
  postHolderObservation,
} from "./holderHistory";

export {
  formatLiveHolderGrowthElapsed,
  formatLiveHolderGrowthLabel,
  isLiveHolderGrowthSignificant,
  normalizeLiveHolderGrowth,
} from "@/lib/discovery/liveHolderGrowth";

export type { LiveHolderGrowthSummary } from "@/lib/discovery/liveHolderGrowth";

export {
  WHALE_SUPPLY_MAJOR_PCT,
  WHALE_SUPPLY_SIGNIFICANT_PCT,
  WHALE_USD_DUST_FLOOR,
  WHALE_USD_MAJOR,
  WHALE_USD_SIGNIFICANT,
  WHALE_AGG_WINDOW_MS,
  classifyWhaleSignificance,
  isWhaleAggregationCandidate,
  fetchWhaleActivity,
  resolveTokenSizeTier,
  tierThresholds,
} from "./whaleActivity";

export {
  deriveWalletSignals,
  formatWalletSignalUsd,
  summarizeWalletSignalsForBadge,
} from "./walletSignals";

export type {
  WalletSignal,
  WalletSignalCode,
  WalletSignalDirection,
} from "./walletSignals";

export type {
  WhaleActivityEvent,
  WhaleActivityFacts,
  WhaleEventKind,
} from "./types";
