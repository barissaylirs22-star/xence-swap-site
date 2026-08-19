import { useEffect, useMemo, useRef } from "react";
import buttonStyles from "@/components/ui/Button.module.css";
import { CopyButton } from "@/components/ui/CopyButton";
import { BrandMark } from "@/components/visual/BrandMark";
import { useClock } from "@/hooks/useClock";
import { useTokenIntelligence } from "@/hooks/useTokenIntelligence";
import {
  explainTokenRisk,
  deriveWalletSignals,
  formatWalletSignalUsd,
  type HolderIntelV2Facts,
  type RiskLevel,
  type RiskReason,
  type WhaleActivityFacts,
  type WalletSignal,
} from "@/lib/intelligence";
import { formatLaunchAge } from "@/lib/pump/mapToken";
import { isAxmToken } from "@/lib/tokens/axm";
import { SOL_MINT } from "@/lib/tokens/catalog";
import {
  formatCapOrFdv,
  formatChangePct,
  formatTokenPriceUsd,
  formatVolumeUsd,
  shortMint,
} from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";
import styles from "./TokenDetailModal.module.css";

const COPY = {
  title: "Token Intelligence",
  market: "Market",
  security: "Security",
  holders: "Holders",
  risk: "Risk Analysis",
  why: "Why",
  positive: "Positive",
  dataConfidence: "Data confidence",
  trade: "Trade Token",
  close: "Close",
  loading: "Loading intelligence…",
  holdersLoading: "Analyzing holders…",
  disclaimer:
    "Risk indicators are data-driven signals, not guarantees.",
  marketCap: "Market Cap / FDV",
  liquidity: "Liquidity",
  volume: "24H Volume",
  age: "Token Age",
  change5m: "5M",
  change1h: "1H",
  change24h: "24H",
  mintAuth: "Mint Authority",
  freezeAuth: "Freeze Authority",
  route: "Jupiter Route",
  impact: "Price Impact",
  holderCount: "Holder Count",
  topHolder: "Largest Holder",
  top10: "Top 10 Holders",
  holderGrowth: "Holder Growth",
  whaleMovement: "Concentration Trend",
  whaleActivity: "Whale Activity",
  whaleNone: "No significant whale activity detected",
  whaleUnavailable: "Whale activity unavailable",
  whaleLoading: "Analyzing whale activity…",
  walletSignals: "Observed wallet activity",
  walletSignalsNote:
    "Observed large-holder activity only — not verified smart money or proven profitability.",
  observedSwaps: "observed swaps",
  observedEvents: "observed events",
  accumulating: "Accumulating",
  distributing: "Distributing",
  mixedActivity: "Mixed activity",
  walletActivity: "Activity",
  reason: "Reason",
  buildingHistory: "Building history...",
  interpretation: "Notes",
  revoked: "Revoked",
  active: "Active",
  unknown: "Unknown",
  available: "Available",
  unavailable: "Unavailable",
  riskUnknown: "Insufficient data",
  holdersRpcBlocked: "RPC blocked largest-accounts",
  holdersTooLarge: "Token too large for largest-accounts",
} as const;

interface TokenDetailModalProps {
  token: TokenAsset | null;
  open: boolean;
  onClose: () => void;
  onTrade: (token: TokenAsset) => void;
}

export function TokenDetailModal({
  token,
  open,
  onClose,
  onTrade,
}: TokenDetailModalProps) {
  const { data, loading, holdersLoading, whaleLoading, error } =
    useTokenIntelligence(open ? token : null);
  const now = useClock(open);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const mintKey = token?.mint ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Always start Token Detail at the top for each open / mint change.
  useEffect(() => {
    if (!open || !mintKey) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = 0;
  }, [open, mintKey]);

  const explanation = useMemo(() => {
    if (!data || !token) return null;
    return explainTokenRisk(data, {
      isNativeSol: token.isNativeSol === true || token.mint === SOL_MINT,
    });
  }, [data, token]);

  if (!open || !token) return null;

  const identity = data?.identity;
  const market = data?.market;
  const security = data?.security;
  const trading = data?.trading;
  const risk = data?.risk;
  const tradeToken = data?.token ?? token;
  const holderIntel = data?.holderIntel;
  const whaleActivity = data?.whaleActivity;

  const name = identity?.name ?? token.name;
  const symbol = identity?.symbol ?? token.symbol;
  const mint = identity?.mint ?? token.mint;
  const imageUrl = identity?.imageUrl ?? token.iconUrl ?? null;
  const price =
    formatTokenPriceUsd(market?.priceUsd ?? token.priceUsd ?? null) ?? "—";
  const riskLevel: RiskLevel =
    explanation?.level ?? risk?.level ?? "UNKNOWN";

  const ageDisplay =
    market?.listedAt != null
      ? formatLaunchAge(market.listedAt, now)
      : "—";

  const cap = formatCapOrFdv(
    market?.marketCapUsd ?? null,
    market?.fdvUsd ?? null,
  );

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} token intelligence`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headerMain}>
            <TokenAvatar symbol={symbol} imageUrl={imageUrl} token={token} />
            <div className={styles.headerText}>
              <div className={styles.titleRow}>
                <h2 className={styles.name}>{name}</h2>
                <span className={styles.symbol}>{symbol}</span>
                <RiskBadge level={riskLevel} />
              </div>
              <div className={styles.mintRow}>
                <span className={styles.mint}>{shortMint(mint)}</span>
                <CopyButton mint={mint} label="Copy" />
              </div>
              <div className={styles.priceRow}>
                <span className={styles.price}>{price}</span>
                {loading && !data ? (
                  <span className={styles.inlineLoad}>{COPY.loading}</span>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={COPY.close}
          >
            ×
          </button>
        </header>

        {error && !data ? (
          <div className={styles.error}>{error}</div>
        ) : null}

        <div className={styles.body} ref={bodyRef}>
          <section className={styles.section} aria-label={COPY.market}>
            <h3 className={styles.sectionTitle}>{COPY.market}</h3>
            <div className={styles.grid}>
              <Stat
                label={COPY.marketCap}
                value={cap ? `${cap.label} ${cap.value}` : "—"}
              />
              <Stat
                label={COPY.liquidity}
                value={dash(formatVolumeUsd(market?.liquidityUsd ?? null))}
              />
              <Stat
                label={COPY.volume}
                value={dash(formatVolumeUsd(market?.volume24hUsd ?? null))}
              />
              <Stat label={COPY.age} value={ageDisplay} />
              <Stat
                label={COPY.change5m}
                value={dash(formatChangePct(market?.priceChange5mPct ?? null))}
                valueClass={changeClass(market?.priceChange5mPct)}
              />
              <Stat
                label={COPY.change1h}
                value={dash(formatChangePct(market?.priceChange1hPct ?? null))}
                valueClass={changeClass(market?.priceChange1hPct)}
              />
              <Stat
                label={COPY.change24h}
                value={dash(formatChangePct(market?.priceChange24hPct ?? null))}
                valueClass={changeClass(market?.priceChange24hPct)}
              />
            </div>
          </section>

          <section className={styles.section} aria-label={COPY.security}>
            <h3 className={styles.sectionTitle}>{COPY.security}</h3>
            <div className={styles.grid}>
              <Stat
                label={COPY.mintAuth}
                value={authorityLabel(security?.mintAuthorityActive ?? null)}
                valueClass={authorityClass(security?.mintAuthorityActive ?? null)}
              />
              <Stat
                label={COPY.freezeAuth}
                value={authorityLabel(security?.freezeAuthorityActive ?? null)}
                valueClass={authorityClass(
                  security?.freezeAuthorityActive ?? null,
                )}
              />
              <Stat
                label={COPY.route}
                value={routeLabel(trading?.routeAvailable ?? null)}
                valueClass={routeClass(trading?.routeAvailable ?? null)}
              />
              <Stat
                label={COPY.impact}
                value={
                  trading?.priceImpactPct != null
                    ? dash(formatChangePct(trading.priceImpactPct))
                    : "—"
                }
                valueClass={
                  trading?.priceImpactLevel === "high"
                    ? styles.warn
                    : trading?.priceImpactLevel === "elevated" ||
                        trading?.priceImpactLevel === "moderate"
                      ? styles.warnSoft
                      : undefined
                }
              />
            </div>
          </section>

          <section className={styles.section} aria-label={COPY.holders}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>{COPY.holders}</h3>
              {holdersLoading ? (
                <span className={styles.inlineLoad}>{COPY.holdersLoading}</span>
              ) : security?.holdersStatus === "error" ||
                security?.holdersStatus === "unavailable" ? (
                <span className={styles.inlineLoad} title={security.holdersError ?? undefined}>
                  {shortHoldersError(security.holdersError) ?? COPY.unavailable}
                </span>
              ) : null}
            </div>
            <div className={styles.grid}>
              <Stat
                label={COPY.holderCount}
                value={formatHolderCount(
                  security?.holderCount ?? null,
                  security?.holdersStatus,
                  holdersLoading,
                )}
              />
              <Stat
                label={COPY.topHolder}
                value={formatHolderPct(
                  security?.topHolderPct ?? null,
                  security?.holdersStatus,
                  holdersLoading,
                )}
                valueClass={
                  security?.topHolderPct != null &&
                  security.topHolderPct >= 35
                    ? styles.warn
                    : undefined
                }
              />
              <Stat
                label={COPY.top10}
                value={formatHolderPct(
                  security?.top10HolderPct ?? null,
                  security?.holdersStatus,
                  holdersLoading,
                )}
                valueClass={
                  security?.top10HolderPct != null &&
                  security.top10HolderPct >= 70
                    ? styles.warn
                    : undefined
                }
              />
            </div>
            {!holdersLoading &&
            security?.holdersStatus !== "pending" &&
            security?.holdersStatus !== "idle" ? (
              <div className={styles.holderIntelNotes} aria-label="Holder intelligence">
                <HolderGrowthBlock
                  intel={holderIntel}
                  status={security?.holdersStatus}
                />
                <ConcentrationTrendBlock
                  intel={holderIntel}
                  status={security?.holdersStatus}
                />
                {holderIntel?.interpretations?.length ? (
                  <p className={styles.holderIntelLine}>
                    <span className={styles.holderIntelLabel}>{COPY.interpretation}</span>
                    <span className={styles.holderIntelValue}>
                      {holderIntel.interpretations.slice(0, 2).join(" · ")}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className={styles.section} aria-label={COPY.whaleActivity}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>{COPY.whaleActivity}</h3>
              {whaleLoading ? (
                <span className={styles.inlineLoad}>{COPY.whaleLoading}</span>
              ) : null}
            </div>
            <WhaleActivityBody
              loading={whaleLoading}
              facts={whaleActivity}
            />
          </section>

          <section
            className={`${styles.section} ${styles.riskSection}`}
            aria-label={COPY.risk}
          >
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>{COPY.risk}</h3>
              <RiskBadge level={riskLevel} large />
            </div>

            {explanation ? (
              <p className={styles.riskSummary}>{explanation.summary}</p>
            ) : loading ? (
              <p className={styles.riskSummaryMuted}>{COPY.loading}</p>
            ) : (
              <p className={styles.riskSummaryMuted}>{COPY.riskUnknown}</p>
            )}

            {explanation?.riskSignals?.length ? (
              <div className={styles.signalBlock}>
                <h4 className={styles.signalHeading}>{COPY.why}</h4>
                <ul className={styles.signalList}>
                  {explanation.riskSignals.map((reason) => (
                    <RiskSignalItem
                      key={`${reason.code}-${reason.message}`}
                      reason={reason}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {explanation?.positiveSignals?.length ? (
              <div className={styles.signalBlock}>
                <h4 className={styles.signalHeading}>{COPY.positive}</h4>
                <ul className={styles.signalList}>
                  {explanation.positiveSignals.map((signal) => (
                    <li
                      key={signal.code}
                      className={[styles.signal, styles.signalPositive].join(
                        " ",
                      )}
                    >
                      <span className={styles.signalMark} aria-hidden>
                        ✓
                      </span>
                      <span>{signal.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {explanation ? (
              <div
                className={styles.riskConfidence}
                aria-label={`${COPY.dataConfidence}: ${explanation.dataConfidence}`}
              >
                <span className={styles.riskConfidenceLabel}>
                  {COPY.dataConfidence}
                </span>
                <span
                  className={[
                    styles.riskConfidenceValue,
                    explanation.dataConfidence === "HIGH"
                      ? styles.confHigh
                      : explanation.dataConfidence === "MEDIUM"
                        ? styles.confMedium
                        : styles.confLow,
                  ].join(" ")}
                >
                  {explanation.dataConfidence}
                </span>
              </div>
            ) : null}

            <p className={styles.disclaimer}>{COPY.disclaimer}</p>
          </section>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            onClick={onClose}
          >
            {COPY.close}
          </button>
          <button
            type="button"
            className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.block}`}
            disabled={!tradeToken.selectable || !tradeToken.mint}
            onClick={() => onTrade(tradeToken)}
          >
            {COPY.trade}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={[styles.statValue, valueClass].filter(Boolean).join(" ")}>
        {value}
      </span>
    </div>
  );
}

function RiskSignalItem({ reason }: { reason: RiskReason }) {
  const tone =
    reason.code === "insufficient_data"
      ? styles.signalMuted
      : reason.code === "high_holder_concentration" ||
          reason.code === "high_top10_concentration" ||
          reason.code === "high_price_impact" ||
          reason.code === "no_jupiter_route"
        ? styles.signalDanger
        : styles.signalWarn;
  return (
    <li className={[styles.signal, tone].join(" ")}>
      <span className={styles.signalMark} aria-hidden>
        •
      </span>
      <span>{reason.message}</span>
    </li>
  );
}

function RiskBadge({
  level,
  large,
}: {
  level: RiskLevel;
  large?: boolean;
}) {
  return (
    <span
      className={[
        styles.riskBadge,
        large ? styles.riskBadgeLarge : "",
        level === "LOW"
          ? styles.riskLow
          : level === "MEDIUM"
            ? styles.riskMedium
            : level === "HIGH"
              ? styles.riskHigh
              : styles.riskUnknown,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {level}
    </span>
  );
}

function TokenAvatar({
  symbol,
  imageUrl,
  token,
}: {
  symbol: string;
  imageUrl: string | null;
  token: TokenAsset;
}) {
  if (isAxmToken(token) || symbol === "AXM") {
    return <BrandMark size={44} className={styles.avatar} />;
  }
  if (imageUrl) {
    return (
      <img
        className={styles.avatar}
        src={imageUrl}
        alt=""
        width={44}
        height={44}
      />
    );
  }
  return <span className={styles.avatarFallback} aria-hidden />;
}

function dash(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "—";
}

/** Holder count has no reliable census — show — once settled. */
function formatHolderCount(
  value: number | null,
  status: string | undefined,
  loading: boolean,
): string {
  if (value != null && Number.isFinite(value)) {
    return value.toLocaleString();
  }
  if (loading || status === "pending") return "—";
  return "—";
}

const GROWTH_WINDOW_ORDER = ["5m", "1h", "6h", "24h"] as const;

function HolderGrowthBlock({
  intel,
  status,
}: {
  intel: HolderIntelV2Facts | null | undefined;
  status: string | undefined;
}) {
  if (status === "error" || status === "unavailable") {
    return (
      <p className={styles.holderIntelLine}>
        <span className={styles.holderIntelLabel}>{COPY.holderGrowth}</span>
        <span className={styles.holderIntelValue}>{COPY.unavailable}</span>
      </p>
    );
  }

  if (!intel?.growth.available) {
    return (
      <p className={styles.holderIntelLine}>
        <span className={styles.holderIntelLabel}>{COPY.holderGrowth}</span>
        <span className={styles.holderIntelValue}>
          {intel?.growth.statusLine ??
            intel?.whale.statusLine ??
            COPY.buildingHistory}
        </span>
      </p>
    );
  }

  const byWindow = new Map(intel.growth.deltas.map((d) => [d.window, d]));
  return (
    <div className={styles.holderIntelSub}>
      <p className={styles.holderIntelSubTitle}>{COPY.holderGrowth}</p>
      <div className={styles.holderIntelWindows}>
        {GROWTH_WINDOW_ORDER.map((w) => {
          const d = byWindow.get(w);
          const value = formatGrowthWindowValue(d);
          return (
            <p key={w} className={styles.holderIntelWindowRow}>
              <span className={styles.holderIntelWin}>{w}</span>
              <span className={styles.holderIntelValue}>{value}</span>
            </p>
          );
        })}
      </div>
      {intel.growth.primaryLine ? (
        <p className={styles.holderIntelDetail}>{intel.growth.primaryLine}</p>
      ) : null}
    </div>
  );
}

function formatGrowthWindowValue(
  d:
    | {
        line?: string;
        percent?: number;
      }
    | undefined,
): string {
  if (!d) return "—";
  if (typeof d.line === "string" && d.line.length > 0) {
    return d.line.replace(/^\S+\s+/, "");
  }
  if (typeof d.percent === "number" && Number.isFinite(d.percent)) {
    const fixed = Math.abs(d.percent) >= 10 ? d.percent.toFixed(1) : d.percent.toFixed(2);
    return d.percent > 0 ? `+${fixed}%` : `${fixed}%`;
  }
  return "—";
}

function ConcentrationTrendBlock({
  intel,
  status,
}: {
  intel: HolderIntelV2Facts | null | undefined;
  status: string | undefined;
}) {
  if (status === "error" || status === "unavailable") {
    return (
      <p className={styles.holderIntelLine}>
        <span className={styles.holderIntelLabel}>{COPY.whaleMovement}</span>
        <span className={styles.holderIntelValue}>{COPY.unavailable}</span>
      </p>
    );
  }

  if (!intel?.whale.available) {
    return (
      <p className={styles.holderIntelLine}>
        <span className={styles.holderIntelLabel}>{COPY.whaleMovement}</span>
        <span className={styles.holderIntelValue}>
          {intel?.whale.statusLine ?? COPY.buildingHistory}
        </span>
      </p>
    );
  }

  const windows = Array.isArray(intel.whale.windows) ? intel.whale.windows : [];
  const preferred =
    windows.find((w) => w.window === intel.whale.preferredWindow) ?? windows[0];

  return (
    <div className={styles.holderIntelSub}>
      <p className={styles.holderIntelSubTitle}>{COPY.whaleMovement}</p>
      {preferred?.largestLine ? (
        <p className={styles.holderIntelDetail}>{preferred.largestLine}</p>
      ) : null}
      {preferred?.top10Line ? (
        <p className={styles.holderIntelDetail}>{preferred.top10Line}</p>
      ) : null}
      {!preferred?.largestLine &&
      !preferred?.top10Line &&
      intel.whale.signals?.[0] ? (
        <p className={styles.holderIntelDetail}>{intel.whale.signals[0]}</p>
      ) : null}
      {windows.length > 1 ? (
        <div className={styles.holderIntelWindows}>
          {GROWTH_WINDOW_ORDER.map((w) => {
            const win = windows.find((x) => x.window === w);
            if (!win) {
              return (
                <p key={w} className={styles.holderIntelWindowRow}>
                  <span className={styles.holderIntelWin}>{w}</span>
                  <span className={styles.holderIntelValue}>—</span>
                </p>
              );
            }
            const bits: string[] = [];
            if (win.largestDeltaPp != null) {
              bits.push(
                `L ${win.largestDeltaPp > 0 ? "↑" : win.largestDeltaPp < 0 ? "↓" : ""}${Math.abs(win.largestDeltaPp).toFixed(1)}pp`,
              );
            }
            if (win.top10DeltaPp != null) {
              bits.push(
                `T10 ${win.top10DeltaPp > 0 ? "↑" : win.top10DeltaPp < 0 ? "↓" : ""}${Math.abs(win.top10DeltaPp).toFixed(1)}pp`,
              );
            }
            return (
              <p key={w} className={styles.holderIntelWindowRow}>
                <span className={styles.holderIntelWin}>{w}</span>
                <span className={styles.holderIntelValue}>
                  {bits.length ? bits.join(" · ") : "—"}
                </span>
              </p>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function WhaleActivityBody({
  loading,
  facts,
}: {
  loading: boolean;
  facts: WhaleActivityFacts | null | undefined;
}) {
  const walletSignals = useMemo(() => deriveWalletSignals(facts), [facts]);

  if (loading && (!facts || facts.status === "pending")) {
    return <p className={styles.whaleMuted}>{COPY.whaleLoading}</p>;
  }
  if (!facts || facts.status === "unavailable") {
    return (
      <div className={styles.whaleBlock}>
        <p className={styles.whaleMuted}>{COPY.whaleUnavailable}</p>
        <p className={styles.whaleNote}>{COPY.walletSignalsNote}</p>
      </div>
    );
  }
  if (!facts.events.length) {
    return (
      <div className={styles.whaleBlock}>
        <p className={styles.whaleMuted}>{COPY.whaleNone}</p>
        <p className={styles.whaleNote}>{COPY.walletSignalsNote}</p>
      </div>
    );
  }
  return (
    <div className={styles.whaleBlock}>
      {walletSignals.length ? (
        <div className={styles.walletSignalList} aria-label={COPY.walletSignals}>
          {walletSignals.map((signal) => (
            <WalletSignalCard key={`${signal.wallet}-${signal.code}`} signal={signal} />
          ))}
        </div>
      ) : null}
      <ul className={styles.whaleList}>
        {facts.events.map((ev) => (
          <li
            key={`${ev.signatures.join("|")}-${ev.wallet}-${ev.kind}`}
            className={styles.whaleItem}
          >
            {ev.line}
          </li>
        ))}
      </ul>
      <p className={styles.whaleNote}>{COPY.walletSignalsNote}</p>
    </div>
  );
}

function WalletSignalCard({ signal }: { signal: WalletSignal }) {
  const usd = formatWalletSignalUsd(signal.usdApprox);
  const directionLabel =
    signal.direction === "accumulating"
      ? COPY.accumulating
      : signal.direction === "distributing"
        ? COPY.distributing
        : signal.direction === "mixed"
          ? COPY.mixedActivity
          : COPY.walletActivity;
  const countLabel =
    signal.swapCount > 0
      ? `${signal.swapCount} ${COPY.observedSwaps}`
      : `${signal.eventCount} ${COPY.observedEvents}`;

  return (
    <div className={styles.walletSignalCard}>
      <div className={styles.walletSignalHead}>
        <span
          className={[
            styles.walletSignalBadge,
            signal.direction === "accumulating"
              ? styles.walletSignalUp
              : signal.direction === "distributing"
                ? styles.walletSignalDown
                : styles.walletSignalNeutral,
          ].join(" ")}
        >
          {signal.label}
        </span>
        <span className={styles.walletSignalAddr} title={signal.wallet}>
          {signal.walletShort}
        </span>
      </div>
      <p className={styles.walletSignalMeta}>
        {directionLabel}
        {usd ? ` ${usd}` : ""}
        {" · "}
        {countLabel}
      </p>
      <p className={styles.walletSignalReason}>
        <span className={styles.walletSignalReasonLabel}>{COPY.reason}</span>
        {signal.reason}
      </p>
    </div>
  );
}

/**
 * Concentration: show % when known; Unavailable after settle without data;
 * dash while still loading.
 */
function formatHolderPct(
  value: number | null,
  status: string | undefined,
  loading: boolean,
): string {
  if (value != null && Number.isFinite(value)) {
    return `${value.toFixed(1)}%`;
  }
  if (loading || status === "pending") return "—";
  if (status === "error" || status === "unavailable" || status === "ready") {
    return COPY.unavailable;
  }
  return "—";
}

/** Compact RPC failure for the holder section status line (no layout change). */
function shortHoldersError(message: string | null | undefined): string | null {
  if (!message) return null;
  const lower = message.toLowerCase();
  if (lower.includes("too many accounts")) {
    return COPY.holdersTooLarge;
  }
  if (lower.includes("request blocked") || lower.includes("access forbidden")) {
    return COPY.holdersRpcBlocked;
  }
  if (lower.includes("429") || lower.includes("too many requests")) {
    return "RPC rate-limited";
  }
  if (lower.includes("timeout")) {
    return "RPC timeout";
  }
  if (lower.includes("not configured") || lower.includes("unauthorized")) {
    return "Holder RPC not configured";
  }
  if (lower.includes("gettokenlargestaccounts failed")) {
    if (lower.includes("too many accounts")) return COPY.holdersTooLarge;
    return COPY.holdersRpcBlocked;
  }
  return COPY.unavailable;
}

function changeClass(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  if (value > 0) return styles.up;
  if (value < 0) return styles.down;
  return undefined;
}

function authorityLabel(active: boolean | null): string {
  if (active === true) return COPY.active;
  if (active === false) return COPY.revoked;
  return COPY.unknown;
}

function authorityClass(active: boolean | null): string | undefined {
  if (active === true) return styles.warn;
  if (active === false) return styles.ok;
  return styles.muted;
}

function routeLabel(available: boolean | null): string {
  if (available === true) return COPY.available;
  if (available === false) return COPY.unavailable;
  return COPY.unknown;
}

function routeClass(available: boolean | null): string | undefined {
  if (available === true) return styles.ok;
  if (available === false) return styles.warn;
  return styles.muted;
}
