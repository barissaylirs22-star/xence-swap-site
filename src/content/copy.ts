export const HERO = {
  eyebrow: "Pre-launch",
  title: "Axiom",
  line: "Coming soon on Pump.fun",
  ctaPrimary: "Launch path",
  ctaSecondary: "Community",
} as const;

export const AXIOM_LIVE = {
  title: "AXIOM LIVE",
  sectionTitle: "Axiom Live",
  sectionLine:
    "See what is moving. Understand why. Check the risk before you trade.",
  trending: "Trending",
  new: "New",
  pump: "Pump.fun",
  loading: "Loading…",
  empty: "No tokens right now",
  unavailable: "Market data unavailable",
  enrichingFilter: "Building this list from live holder signals…",
  earlySignalsEmpty: "No early multi-signal setups right now",
  loadMore: "Load more",
  newBadge: "New",
  statusLive: "LIVE",
  statusReconnecting: "RECONNECTING",
  statusFallback: "FALLBACK",
  statusConnecting: "CONNECTING",
  pumpWaiting: "Waiting for new launches…",
  pumpFallbackNote: "Realtime unavailable — showing discovery snapshot",
  creator: "Dev",
} as const;

export const AXIOM_RADAR = {
  title: "AXIOM RADAR",
  sectionTitle: "Axiom Radar",
  sectionLine:
    "Important changes across tokens Axiom is observing — not a ranking, not a prediction.",
  loading: "Scanning observed tokens for notable changes…",
  empty: "No notable changes in enriched tokens right now",
  unavailable: "Market data unavailable — Radar is idle",
  degraded:
    "Structural holder signals are still building — market-only changes may appear as enrichment arrives",
  watching: "Watching",
  enriched: "enriched",
  of: "of",
  loaded: "loaded",
  window: "Window",
  liveBadge: "LIVE",
} as const;

export const JOURNEY = [
  { step: "01", title: "Brand", detail: "Live" },
  { step: "02", title: "Site", detail: "Live" },
  { step: "03", title: "Pump.fun", detail: "Next" },
  { step: "04", title: "Trade", detail: "Soon" },
] as const;

export const CAROUSEL = [
  {
    title: "Precision",
    line: "Clarity first.",
  },
  {
    title: "Solana",
    line: "Built for speed.",
  },
  {
    title: "Launch",
    line: "Arriving on Pump.fun.",
  },
  {
    title: "Trust",
    line: "Real when live.",
  },
] as const;

export const LAUNCH_SECTION = {
  label: "Launch",
  title: "Pump.fun",
  status: "Pre-launch",
  line: "Axiom is preparing to launch on Pump.fun.",
  support: "The token is not live yet.",
} as const;

export const TRADING_PREVIEW = {
  label: "Trading",
  title: "Axiom Swap",
  line: "Swap supported Solana tokens. AXM joins after Pump.fun launch.",
} as const;

export const COMMUNITY = {
  label: "Community",
  title: "Stay close",
} as const;

export const DISCLAIMER =
  "Axiom is in pre-launch. The token is not live yet. Not financial advice.";
