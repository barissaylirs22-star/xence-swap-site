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
  RISK_TOP10_HIGH_PCT,
  RISK_TOP10_MEDIUM_PCT,
  RISK_TOP_HOLDER_HIGH_PCT,
  RISK_TOP_HOLDER_MEDIUM_PCT,
  RISK_VERY_LOW_LIQUIDITY_USD,
  RISK_VERY_NEW_MS,
} from "./risk";

export {
  AXIOM_SCORE_WEIGHTS,
  SCORE_DEADZONE,
  alignRiskWithAxiomScore,
  classifyAxiomScore,
  computeAxiomScore,
  computeAxiomScoreLite,
  finalizeRiskAndScore,
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
  CONCENTRATION_SHORT_RISK_PP,
  CONCENTRATION_STABLE_MAX_PP,
  HOLDER_GROWTH_WINDOWS,
  HOLDERS_FALLING_ABS,
  HOLDERS_FALLING_PCT,
  HOLDER_INTEL_API_PATH,
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

export type {
  WhaleActivityEvent,
  WhaleActivityFacts,
  WhaleEventKind,
} from "./types";
