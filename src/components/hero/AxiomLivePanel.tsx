import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AXIOM_LIVE } from "@/content/copy";
import { SWAP_COPY } from "@/content/swap";
import { TokenDetailModal } from "@/components/intelligence/TokenDetailModal";
import { useAxiomLive } from "@/hooks/useAxiomLive";
import { useClock } from "@/hooks/useClock";
import { useDexMarketByMints } from "@/hooks/useDexMarketByMints";
import { useDiscoveryEnrichment } from "@/hooks/useDiscoveryEnrichment";
import { usePumpFunStream } from "@/hooks/usePumpFunStream";
import { BrandMark } from "@/components/visual/BrandMark";
import type { DexMarketMetrics } from "@/lib/market/dexscreener";
import {
  applyDiscoveryFilter,
  DISCOVERY_FILTERS,
  DISCOVERY_PAGE_SIZE,
  type DiscoveryEnrichment,
  type DiscoveryFilterId,
} from "@/lib/discovery/filters";
import { assessEarlySignal } from "@/lib/discovery/earlySignals";
import {
  getFullAxiomScoreCacheVersion,
  lightweightBandTone,
  resolveLiveAxiomScore,
  subscribeFullAxiomScoreCache,
  type ResolvedLiveAxiomScore,
} from "@/lib/discovery/resolvedAxiomScore";
import { deriveConcentrationCue } from "@/lib/discovery/concentrationCue";
import {
  formatLiveHolderGrowthLabel,
  isLiveHolderGrowthSignificant,
} from "@/lib/discovery/liveHolderGrowth";
import { deriveMovementReason } from "@/lib/discovery/movementReason";
import {
  formatCapOrFdv,
  formatChangePct,
  formatTokenPriceUsd,
  formatVolumeUsd,
  shortMint,
} from "@/lib/tokens/catalog";
import { formatLaunchAge, shortKey } from "@/lib/pump/mapToken";
import type { PumpFeedStatus, PumpLaunchToken } from "@/lib/pump/types";
import { isAxmToken } from "@/lib/tokens/axm";
import type { AxiomLiveTabId } from "@/lib/tokens/live";
import type { TokenAsset } from "@/lib/tokens/types";
import type { RiskLevel } from "@/lib/intelligence/types";
import { useSwapIntent } from "@/lib/swap/useSwapIntent";
import styles from "./AxiomLivePanel.module.css";

/** Prevent Token Detail render failures from blanking the entire homepage. */
class TokenDetailErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[axiom] Token Detail render failed", error);
  }

  render() {
    if (this.state.failed) {
      return null;
    }
    return this.props.children;
  }
}

function pumpStatusLabel(status: PumpFeedStatus): string {
  switch (status) {
    case "live":
      return AXIOM_LIVE.statusLive;
    case "reconnecting":
      return AXIOM_LIVE.statusReconnecting;
    case "fallback":
      return AXIOM_LIVE.statusFallback;
    default:
      return AXIOM_LIVE.statusConnecting;
  }
}

function dash(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "—";
}

function changeClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return styles.muted;
  }
  if (value > 0) return styles.up;
  if (value < 0) return styles.down;
  return styles.muted;
}

function mergeMetrics(
  token: TokenAsset,
  metrics?: DexMarketMetrics,
): TokenAsset {
  if (!metrics) return token;
  return {
    ...token,
    priceUsd: metrics.priceUsd ?? token.priceUsd ?? null,
    priceChange5mPct: metrics.priceChange5mPct ?? token.priceChange5mPct ?? null,
    priceChange1hPct: metrics.priceChange1hPct ?? token.priceChange1hPct ?? null,
    priceChange24hPct:
      metrics.priceChange24hPct ?? token.priceChange24hPct ?? null,
    volume24hUsd: metrics.volume24hUsd ?? token.volume24hUsd ?? null,
    liquidityUsd: metrics.liquidityUsd ?? token.liquidityUsd ?? null,
    marketCapUsd: metrics.marketCapUsd ?? token.marketCapUsd ?? null,
    fdvUsd: metrics.fdvUsd ?? token.fdvUsd ?? null,
    listedAt: metrics.listedAt ?? token.listedAt ?? null,
  };
}

function riskBadgeClass(level: RiskLevel | null | undefined): string {
  if (level === "LOW") return styles.riskLow;
  if (level === "MEDIUM") return styles.riskMed;
  if (level === "HIGH") return styles.riskHigh;
  return styles.riskUnknown;
}

function axmBadgeClass(score: ResolvedLiveAxiomScore | null | undefined): string {
  if (!score) return styles.axmMuted;
  const tone = lightweightBandTone(score.band);
  if (tone === "strong") return styles.axmStrong;
  if (tone === "healthy") return styles.axmHealthy;
  if (tone === "caution") return styles.axmCaution;
  return styles.axmRisk;
}

function earlyBadgeClass(tone: string, level?: string): string {
  if (tone === "caution") return styles.earlyCaution;
  if (level === "strong") return styles.earlyStrong;
  if (level === "building") return styles.earlyBuilding;
  return styles.earlyEarly;
}

export function AxiomLivePanel({
  layout = "embedded",
}: {
  layout?: "embedded" | "primary";
}) {
  const { tabs, loading } = useAxiomLive();
  const pump = usePumpFunStream();
  const { selectLiveReceiveToken } = useSwapIntent();
  const [tab, setTab] = useState<AxiomLiveTabId>("trending");
  const [detailToken, setDetailToken] = useState<TokenAsset | null>(null);
  const [visibleCount, setVisibleCount] = useState(DISCOVERY_PAGE_SIZE);
  const now = useClock(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const isPrimary = layout === "primary";
  const fullScoreEpoch = useSyncExternalStore(
    subscribeFullAxiomScoreCache,
    getFullAxiomScoreCacheVersion,
    () => 0,
  );

  const universe = useMemo(() => {
    const trending = tabs.find((t) => t.id === "trending");
    return trending?.tokens ?? tabs[0]?.tokens ?? [];
  }, [tabs]);

  const universeUnavailable = useMemo(() => {
    const trending = tabs.find((t) => t.id === "trending");
    return Boolean(trending?.unavailable);
  }, [tabs]);

  const enrichment = useDiscoveryEnrichment(
    universe,
    tab !== "pump" && universe.length > 0,
  );

  const filtered = useMemo(() => {
    // Re-resolve when Token Detail publishes a Full Score for a mint.
    void fullScoreEpoch;
    if (tab === "pump") return [];
    return applyDiscoveryFilter(
      universe,
      tab as DiscoveryFilterId,
      enrichment,
      now,
    );
  }, [universe, tab, enrichment, now, fullScoreEpoch]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(DISCOVERY_PAGE_SIZE);
    listRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const openDetail = (token: TokenAsset) => {
    if (!token.selectable || !token.mint) return;
    setDetailToken(token);
  };

  const closeDetail = () => setDetailToken(null);

  const tradeFromDetail = (token: TokenAsset) => {
    setDetailToken(null);
    selectLiveReceiveToken(token);
  };

  const onListScroll = () => {
    const el = listRef.current;
    if (!el || tab === "pump") return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      setVisibleCount((n) => Math.min(n + DISCOVERY_PAGE_SIZE, filtered.length));
    }
  };

  const statusLabel =
    tab === "pump" ? pumpStatusLabel(pump.status) : AXIOM_LIVE.statusLive;
  const statusClass =
    tab === "pump" && pump.status === "fallback"
      ? styles.statusFallback
      : tab === "pump" && pump.status === "reconnecting"
        ? styles.statusReconnect
        : styles.live;

  return (
    <div
      className={[styles.panel, isPrimary ? styles.panelPrimary : ""]
        .filter(Boolean)
        .join(" ")}
      aria-label={AXIOM_LIVE.title}
    >
      <div className={styles.head}>
        <div className={styles.titleRow}>
          {isPrimary ? (
            <span className={styles.title}>Discovery</span>
          ) : (
            <span className={styles.title}>{AXIOM_LIVE.title}</span>
          )}
          <span className={statusClass}>
            <span className={styles.liveDot} aria-hidden />
            {statusLabel}
          </span>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Discovery filters">
        {DISCOVERY_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={[styles.tab, tab === item.id ? styles.tabActive : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setTab(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {isPrimary ? (
        <div className={styles.colHead} aria-hidden>
          <span className={styles.colHeadSpacer} />
          <span>Token</span>
          <span>Why moving</span>
          <span>Holder</span>
          <span>5m</span>
          <span>1h</span>
          <span>Liq</span>
          <span>24h vol</span>
          <span>MC</span>
          <span>Hld</span>
          <span>AXM</span>
          <span>Price</span>
        </div>
      ) : null}

      <div
        className={styles.list}
        role="tabpanel"
        ref={listRef}
        onScroll={onListScroll}
      >
        {tab === "pump" ? (
          <PumpTabBody
            tokens={pump.tokens}
            status={pump.status}
            mode={pump.mode}
            now={now}
            onSelect={openDetail}
          />
        ) : loading && universe.length === 0 ? (
          <div className={styles.note}>{AXIOM_LIVE.loading}</div>
        ) : universeUnavailable ? (
          <div className={styles.note}>{AXIOM_LIVE.unavailable}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.note}>
            {tab === "most_holders" || tab === "low_risk"
              ? AXIOM_LIVE.enrichingFilter
              : tab === "early_signals"
                ? AXIOM_LIVE.earlySignalsEmpty
                : AXIOM_LIVE.empty}
          </div>
        ) : (
          <>
            {visible.map((token) => (
              <LiveTokenRow
                key={`${tab}-${token.mint}`}
                token={token}
                ageMs={token.listedAt ?? null}
                now={now}
                enrichment={enrichment.get(token.mint)}
                onPick={openDetail}
              />
            ))}
            {visibleCount < filtered.length ? (
              <button
                type="button"
                className={styles.loadMore}
                onClick={() =>
                  setVisibleCount((n) =>
                    Math.min(n + DISCOVERY_PAGE_SIZE, filtered.length),
                  )
                }
              >
                {AXIOM_LIVE.loadMore} ({filtered.length - visibleCount} more)
              </button>
            ) : null}
          </>
        )}
      </div>

      <TokenDetailErrorBoundary key={detailToken?.mint ?? "closed"}>
        <TokenDetailModal
          token={detailToken}
          open={detailToken !== null}
          onClose={closeDetail}
          onTrade={tradeFromDetail}
        />
      </TokenDetailErrorBoundary>
    </div>
  );
}

function PumpTabBody({
  tokens,
  status,
  mode,
  now,
  onSelect,
}: {
  tokens: PumpLaunchToken[];
  status: PumpFeedStatus;
  mode: "realtime" | "fallback";
  now: number;
  onSelect: (token: TokenAsset) => void;
}) {
  const mints = useMemo(() => tokens.map((t) => t.mint), [tokens]);
  const dexByMint = useDexMarketByMints(mints);

  if (status === "connecting" && tokens.length === 0) {
    return <div className={styles.note}>{AXIOM_LIVE.loading}</div>;
  }

  if (tokens.length === 0) {
    return (
      <div className={styles.note}>
        {status === "fallback"
          ? AXIOM_LIVE.unavailable
          : AXIOM_LIVE.pumpWaiting}
      </div>
    );
  }

  return (
    <>
      {mode === "fallback" ? (
        <div className={styles.feedNote}>{AXIOM_LIVE.pumpFallbackNote}</div>
      ) : null}
      {tokens.map((token) => {
        const display = mergeMetrics(token, dexByMint.get(token.mint));
        return (
          <LiveTokenRow
            key={`pump-${token.mint}`}
            token={display}
            ageMs={token.launchedAt}
            now={now}
            creator={token.creator}
            onPick={onSelect}
          />
        );
      })}
    </>
  );
}

function LiveTokenRow({
  token,
  ageMs,
  now,
  creator,
  enrichment,
  onPick,
}: {
  token: TokenAsset;
  ageMs: number | null;
  now: number;
  creator?: string | null;
  enrichment?: DiscoveryEnrichment;
  onPick: (token: TokenAsset) => void;
}) {
  const price = formatTokenPriceUsd(token.priceUsd ?? null);
  const ch5 = formatChangePct(token.priceChange5mPct ?? null);
  const ch1h = formatChangePct(token.priceChange1hPct ?? null);
  const liq = formatVolumeUsd(token.liquidityUsd ?? null);
  const cap = formatCapOrFdv(token.marketCapUsd ?? null, token.fdvUsd ?? null);
  const vol = formatVolumeUsd(token.volume24hUsd ?? null);
  const age =
    typeof ageMs === "number" && Number.isFinite(ageMs)
      ? formatLaunchAge(ageMs, now)
      : null;
  const showUnverified =
    Boolean(token.warnings?.includes("unverified")) ||
    Boolean(token.warnings?.includes("unknown_metadata"));

  const holders =
    enrichment?.holderCount != null
      ? enrichment.holderCount.toLocaleString("en-US")
      : enrichment?.status === "loading"
        ? "…"
        : "—";
  const riskLevel = enrichment?.riskLevel ?? null;
  const axmScore = resolveLiveAxiomScore(token, enrichment, now);
  const earlySignal = assessEarlySignal(token, enrichment, now);
  const earlyPrimary = earlySignal.livePrimary;
  const earlyCaution = earlySignal.liveCaution;
  const movement = deriveMovementReason(token, now);
  const concentration = deriveConcentrationCue(enrichment);
  const growthSummary =
    enrichment?.holderGrowth &&
    isLiveHolderGrowthSignificant(enrichment.holderGrowth)
      ? enrichment.holderGrowth
      : null;
  const growthLabel = growthSummary
    ? formatLiveHolderGrowthLabel(growthSummary)
    : null;
  const growthUp = growthSummary != null && growthSummary.absolute > 0;
  const growthDown = growthSummary != null && growthSummary.absolute < 0;

  return (
    <button
      type="button"
      className={styles.row}
      disabled={!token.selectable}
      onClick={() => onPick(token)}
      aria-label={`${token.symbol} token`}
      data-mint={token.mint}
      data-discovery-enrich="1"
    >
      <TokenIcon token={token} />
      <div className={styles.identity}>
        <div className={styles.symbolRow}>
          <span className={styles.symbol}>{token.symbol}</span>
          {riskLevel ? (
            <span className={riskBadgeClass(riskLevel)}>{riskLevel}</span>
          ) : null}
          {earlyPrimary ? (
            <span
              className={[
                styles.earlyBadge,
                earlyBadgeClass(earlyPrimary.tone, earlySignal.level),
              ].join(" ")}
              title={[
                `Early Signal · ${earlyPrimary.label}`,
                "Observable change cue — not a price prediction",
                earlyPrimary.explanation,
                ...(earlyCaution
                  ? [`• ${earlyCaution.label}: ${earlyCaution.explanation}`]
                  : []),
              ].join("\n")}
            >
              {earlyPrimary.label}
            </span>
          ) : null}
          {earlyCaution ? (
            <span
              className={[styles.earlyBadge, styles.earlyCaution].join(" ")}
              title={[
                `Early Signal · ${earlyCaution.label}`,
                "Observable change cue — not a price prediction",
                earlyCaution.explanation,
              ].join("\n")}
            >
              {earlyCaution.label}
            </span>
          ) : null}
          {showUnverified ? (
            <span className={styles.badgeWarn}>{SWAP_COPY.unverified}</span>
          ) : null}
        </div>
        <div className={styles.name}>{token.name}</div>
        <div className={styles.mintLine}>
          {shortMint(token.mint)}
          {creator ? (
            <span>
              {" "}
              · {AXIOM_LIVE.creator} {shortKey(creator)}
            </span>
          ) : null}
        </div>
      </div>

      <div className={styles.whyCol}>
        {movement ? (
          <div className={styles.moveReason} title="Observable market signal">
            {movement.label}
          </div>
        ) : (
          <span className={styles.signalEmpty}>—</span>
        )}
      </div>

      <div className={styles.holderCol}>
        {growthLabel && growthSummary ? (
          <div
            className={[
              styles.hldGrowth,
              growthUp
                ? styles.hldGrowthUp
                : growthDown
                  ? styles.hldGrowthDown
                  : styles.hldGrowthFlat,
            ].join(" ")}
            title={`Holders ${growthSummary.fromCount.toLocaleString("en-US")} → ${growthSummary.toCount.toLocaleString("en-US")}`}
          >
            {growthLabel}
          </div>
        ) : null}
        {concentration ? (
          <div
            className={[
              styles.concCue,
              concentration.severity === "high"
                ? styles.concHigh
                : styles.concMed,
            ].join(" ")}
            title={
              concentration.id === "top_holder"
                ? `Largest holder share ${concentration.pct.toFixed(1)}%`
                : `Top-10 holder share ${concentration.pct.toFixed(1)}%`
            }
          >
            {concentration.label}
          </div>
        ) : null}
        {!growthLabel && !concentration ? (
          <span className={styles.signalEmpty}>—</span>
        ) : null}
      </div>

      <div className={styles.metrics} aria-label="Market metrics">
        <Metric
          label="5m"
          value={dash(ch5)}
          valueClass={changeClass(token.priceChange5mPct)}
          title={
            token.priceChange5mPct != null &&
            Number.isFinite(token.priceChange5mPct)
              ? `${token.priceChange5mPct > 0 ? "+" : ""}${token.priceChange5mPct}%`
              : undefined
          }
        />
        <Metric
          label="1h"
          value={dash(ch1h)}
          valueClass={changeClass(token.priceChange1hPct)}
          title={
            token.priceChange1hPct != null &&
            Number.isFinite(token.priceChange1hPct)
              ? `${token.priceChange1hPct > 0 ? "+" : ""}${token.priceChange1hPct}%`
              : undefined
          }
        />
        <Metric label="LIQ" value={dash(liq)} />
        <Metric label="24H VOL" value={dash(vol)} />
        <Metric label={cap?.label ?? "MC"} value={cap ? cap.value : "—"} />
        <Metric label="HLD" value={holders} />
      </div>

      <div className={styles.trail}>
        {axmScore ? (
          <span
            className={[styles.axmBadge, axmBadgeClass(axmScore)].join(" ")}
            title={
              axmScore.mode === "full"
                ? `Axiom Score ${axmScore.score} · ${axmScore.label} · structural tradeability from full analysis — not a safety guarantee or buy/sell signal`
                : `Axiom Score ${axmScore.score} · ${axmScore.label} · lightweight LIVE preview (incomplete evidence) — not a safety guarantee or buy/sell signal`
            }
          >
            AXM {axmScore.score}
          </span>
        ) : (
          <span className={[styles.axmBadge, styles.axmMuted].join(" ")}>
            AXM —
          </span>
        )}
        <span className={styles.price}>{dash(price)}</span>
        <span className={styles.age}>{dash(age)}</span>
      </div>
    </button>
  );
}

function Metric({
  label,
  value,
  valueClass,
  title,
}: {
  label: string;
  value: string;
  valueClass?: string;
  title?: string;
}) {
  return (
    <span className={styles.metric} title={title}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={[styles.metricValue, valueClass].filter(Boolean).join(" ")}>
        {value}
      </span>
    </span>
  );
}

function TokenIcon({ token }: { token: TokenAsset }) {
  if (isAxmToken(token) || token.symbol === "AXM") {
    return <BrandMark size={28} className={styles.icon} />;
  }
  if (token.iconUrl) {
    return (
      <img
        className={styles.icon}
        src={token.iconUrl}
        alt=""
        width={28}
        height={28}
        loading="lazy"
      />
    );
  }
  return <span className={styles.iconFallback} aria-hidden />;
}
