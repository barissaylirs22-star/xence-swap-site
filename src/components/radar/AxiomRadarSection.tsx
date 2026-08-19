import { Component, useMemo, useState, type ReactNode } from "react";
import { AXIOM_RADAR } from "@/content/copy";
import { TokenDetailModal } from "@/components/intelligence/TokenDetailModal";
import { BrandMark } from "@/components/visual/BrandMark";
import { useAxiomRadar } from "@/hooks/useAxiomRadar";
import {
  radarSeverityLabel,
  type RadarDirection,
  type RadarEvent,
  type RadarEventType,
  type RadarSeverity,
} from "@/lib/discovery/radarEvents";
import { shortMint } from "@/lib/tokens/catalog";
import { isAxmToken } from "@/lib/tokens/axm";
import type { TokenAsset } from "@/lib/tokens/types";
import { useSwapIntent } from "@/lib/swap/useSwapIntent";
import styles from "./AxiomRadarSection.module.css";

/** Prevent Token Detail failures from blanking the Radar section. */
class TokenDetailErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[axiom] Radar Token Detail render failed", error);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function directionClass(direction: RadarDirection): string {
  if (direction === "positive") return styles.dirPositive;
  if (direction === "caution") return styles.dirCaution;
  return styles.dirNeutral;
}

function severityClass(severity: RadarSeverity): string {
  if (severity === "critical") return styles.sevCritical;
  if (severity === "high") return styles.sevHigh;
  if (severity === "watch") return styles.sevWatch;
  return styles.sevInfo;
}

function usableMetric(label: string, value: string): boolean {
  const v = value.trim();
  if (!label.trim() || !v) return false;
  if (v === "—" || v === "-" || v === "--" || v === "–") return false;
  return true;
}

/** MULTI_SIGNAL reasons are joined real component titles. */
function multiSignalChips(event: RadarEvent): string[] {
  if (event.type !== "MULTI_SIGNAL") return [];
  return event.reason
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Single-signal events: one chip from the real title when useful. */
function supportChips(event: RadarEvent): string[] {
  const multi = multiSignalChips(event);
  if (multi.length > 0) return multi;
  if (event.type === "EARLY_SIGNAL") return [event.title];
  return [];
}

function metricValueTone(value: string): string {
  const t = value.trim();
  if (t.startsWith("+")) return styles.valPositive;
  if (t.startsWith("-") && t !== "-" && t !== "--") return styles.valCaution;
  return styles.valNeutral;
}

function chipTone(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("rising") || l.includes("contract")) return styles.chipCaution;
  if (
    l.includes("improving") ||
    l.includes("acceleration") ||
    l.includes("momentum") ||
    l.includes("volume") ||
    l.includes("holder") ||
    l.includes("expand")
  ) {
    return styles.chipPositive;
  }
  if (l.includes("early")) return styles.chipEarly;
  if (l === "concentration" || l === "liquidity") return styles.chipNeutral;
  return styles.chipNeutral;
}

const LEGEND_TYPES: Array<{ type: RadarEventType; label: string }> = [
  { type: "CONCENTRATION_RISING", label: "Concentration" },
  { type: "DISTRIBUTION_IMPROVING", label: "Concentration" },
  { type: "MOMENTUM_SHIFT", label: "Momentum" },
  { type: "VOLUME_ACCELERATION", label: "Volume" },
  { type: "EARLY_SIGNAL", label: "Early Signal" },
  { type: "LIQUIDITY_MOVE", label: "Liquidity" },
];

function legendLabelsFromEvents(events: RadarEvent[]): string[] {
  const present = new Set<string>();
  for (const ev of events) {
    if (ev.type === "MULTI_SIGNAL") {
      const key = ev.dedupeKey;
      if (key.includes("CONCENTRATION") || key.includes("DISTRIBUTION")) {
        present.add("Concentration");
      }
      if (key.includes("MOMENTUM")) present.add("Momentum");
      if (key.includes("VOLUME")) present.add("Volume");
      if (key.includes("EARLY")) present.add("Early Signal");
      if (key.includes("LIQUIDITY")) present.add("Liquidity");
      if (key.includes("HOLDER")) present.add("Holders");
      continue;
    }
    for (const row of LEGEND_TYPES) {
      if (row.type === ev.type) present.add(row.label);
    }
    if (ev.type === "HOLDER_ACCELERATION") present.add("Holders");
  }
  return [...present];
}

function RadarTokenIcon({ token }: { token: TokenAsset | undefined }) {
  if (!token) {
    return <span className={styles.iconFallback} aria-hidden />;
  }
  if (isAxmToken(token) || token.symbol === "AXM") {
    return <BrandMark size={36} className={styles.icon} />;
  }
  if (token.iconUrl) {
    return (
      <img
        className={styles.icon}
        src={token.iconUrl}
        alt=""
        width={36}
        height={36}
        loading="lazy"
      />
    );
  }
  return <span className={styles.iconFallback} aria-hidden />;
}

function EventCard({
  event,
  token,
  onOpen,
}: {
  event: RadarEvent;
  token: TokenAsset | undefined;
  onOpen: (mint: string) => void;
}) {
  const chips = supportChips(event);
  const metrics = event.metrics
    .filter((m) => usableMetric(m.label, m.value))
    .filter(
      (m) =>
        !(event.type === "MULTI_SIGNAL" && m.label.toLowerCase() === "signals"),
    )
    .slice(0, 4);

  const showReason =
    event.reason.trim().length > 0 &&
    (event.type === "MULTI_SIGNAL"
      ? false
      : event.reason !== event.title);

  return (
    <button
      type="button"
      className={[styles.event, directionClass(event.direction)].join(" ")}
      onClick={() => onOpen(event.mint)}
      aria-label={`${event.symbol}: ${event.title}. Open token detail.`}
    >
      <div className={styles.colLeft}>
        <span
          className={[styles.severity, severityClass(event.severity)].join(" ")}
        >
          {radarSeverityLabel(event.severity)}
        </span>
        <div className={styles.tokenBlock}>
          <RadarTokenIcon token={token} />
          <div className={styles.tokenText}>
            <div className={styles.symbolRow}>
              <span className={styles.symbol}>{event.symbol}</span>
              <span className={styles.livePill}>{AXIOM_RADAR.liveBadge}</span>
            </div>
            <span className={styles.name}>{event.name}</span>
            <span className={styles.mint}>{shortMint(event.mint)}</span>
          </div>
        </div>
      </div>

      <div className={styles.colCenter}>
        <h3 className={styles.eventTitle}>{event.title}</h3>
        {showReason ? <p className={styles.reason}>{event.reason}</p> : null}
        {chips.length > 0 ? (
          <div className={styles.chips} aria-label="Supporting signals">
            {chips.map((chip) => (
              <span
                key={`${event.id}-${chip}`}
                className={[styles.chip, chipTone(chip)].join(" ")}
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.colRight}>
        {metrics.length > 0 ? (
          <div className={styles.metrics} aria-label="Supporting metrics">
            {metrics.map((m) => (
              <div key={`${event.id}-${m.label}`} className={styles.metric}>
                <span className={styles.metricLabel}>{m.label}</span>
                <span
                  className={[styles.metricValue, metricValueTone(m.value)].join(
                    " ",
                  )}
                >
                  {m.value}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.metricsEmpty} aria-hidden />
        )}
        <div className={styles.affordance}>
          {event.window ? (
            <span className={styles.window}>{event.window}</span>
          ) : null}
          <span className={styles.openCue} aria-hidden>
            →
          </span>
        </div>
      </div>
    </button>
  );
}

/** Dedicated event/change feed — not an Axiom Live filter tab. */
export function AxiomRadarSection() {
  const { events, status, observedCount, enrichedReadyCount, tokensByMint } =
    useAxiomRadar();
  const { selectLiveReceiveToken } = useSwapIntent();
  const [detailToken, setDetailToken] = useState<TokenAsset | null>(null);

  const legend = useMemo(() => legendLabelsFromEvents(events), [events]);

  const openDetail = (mint: string) => {
    const token = tokensByMint.get(mint);
    if (!token?.selectable || !token.mint) return;
    setDetailToken(token);
  };

  const closeDetail = () => setDetailToken(null);

  const tradeFromDetail = (token: TokenAsset) => {
    setDetailToken(null);
    selectLiveReceiveToken(token);
  };

  return (
    <section
      id="radar"
      className={`full-bleed section sectionCompact ${styles.section}`}
      aria-labelledby="radar-title"
    >
      <div className={`page ${styles.shell}`}>
        <header className={styles.intro}>
          <div className={styles.eyebrowRow}>
            <p className={styles.brandTitle}>{AXIOM_RADAR.title}</p>
          </div>
          <h2 id="radar-title" className={styles.heading}>
            {AXIOM_RADAR.sectionTitle}
          </h2>
          <p className={styles.line}>{AXIOM_RADAR.sectionLine}</p>

          {observedCount > 0 ? (
            <div className={styles.statusRow} aria-label="Radar coverage">
              <span className={styles.statusLive}>
                <span className={styles.liveDot} aria-hidden />
                {AXIOM_RADAR.liveBadge}
              </span>
              <span className={styles.statusStat}>
                <span className={styles.statusKey}>{AXIOM_RADAR.watching}</span>
                <span className={styles.statusVal}>
                  {enrichedReadyCount.toLocaleString("en-US")}
                </span>
              </span>
              <span className={styles.statusStat}>
                <span className={styles.statusVal}>
                  {AXIOM_RADAR.enriched} {AXIOM_RADAR.of}{" "}
                  {observedCount.toLocaleString("en-US")} {AXIOM_RADAR.loaded}
                </span>
              </span>
            </div>
          ) : null}
        </header>

        <div
          className={styles.feed}
          role="feed"
          aria-busy={status === "loading"}
        >
          {status === "loading" ? (
            <div className={styles.note}>{AXIOM_RADAR.loading}</div>
          ) : null}
          {status === "unavailable" ? (
            <div className={styles.note}>{AXIOM_RADAR.unavailable}</div>
          ) : null}
          {status === "degraded" ? (
            <div className={styles.note}>{AXIOM_RADAR.degraded}</div>
          ) : null}
          {status === "empty" ? (
            <div className={styles.note}>{AXIOM_RADAR.empty}</div>
          ) : null}
          {status === "ready"
            ? events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  token={tokensByMint.get(event.mint)}
                  onOpen={openDetail}
                />
              ))
            : null}
        </div>

        {status === "ready" && legend.length > 0 ? (
          <footer className={styles.legend} aria-label="Signal legend">
            {legend.map((label) => (
              <span key={label} className={styles.legendItem}>
                <span
                  className={[styles.legendDot, chipTone(label)].join(" ")}
                  aria-hidden
                />
                {label}
              </span>
            ))}
          </footer>
        ) : null}
      </div>

      <TokenDetailErrorBoundary key={detailToken?.mint ?? "closed"}>
        <TokenDetailModal
          token={detailToken}
          open={detailToken !== null}
          onClose={closeDetail}
          onTrade={tradeFromDetail}
        />
      </TokenDetailErrorBoundary>
    </section>
  );
}
