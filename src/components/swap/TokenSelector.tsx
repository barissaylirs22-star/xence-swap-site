import { useEffect, useMemo, useState } from "react";
import { SWAP_COPY } from "@/content/swap";
import { useTokenBrowse } from "@/hooks/useTokenBrowse";
import { useTokenSearch } from "@/hooks/useTokenSearch";
import { BrandMark } from "@/components/visual/BrandMark";
import {
  formatChangePct,
  formatVolumeUsd,
  shortMint,
} from "@/lib/tokens/catalog";
import { isAxmToken } from "@/lib/tokens/axm";
import type { TokenAsset, TokenWarning } from "@/lib/tokens/types";
import styles from "./TokenSelector.module.css";

interface TokenSelectorProps {
  open: boolean;
  title?: string;
  excludeMint?: string;
  balances?: Record<string, number | null>;
  onClose: () => void;
  onSelect: (token: TokenAsset) => void;
}

function warningLabel(warning: TokenWarning): string {
  switch (warning) {
    case "coming_soon":
      return SWAP_COPY.comingSoon;
    case "unverified":
      return SWAP_COPY.unverified;
    case "unknown_metadata":
      return SWAP_COPY.unknownMeta;
    case "no_route":
      return "No route";
    case "low_liquidity":
      return "Low liquidity";
    default:
      return warning;
  }
}

export function TokenSelector({
  open,
  title = SWAP_COPY.selectToken,
  excludeMint,
  balances,
  onClose,
  onSelect,
}: TokenSelectorProps) {
  const [query, setQuery] = useState("");
  const balanceKey = useMemo(
    () => JSON.stringify(balances ?? {}),
    [balances],
  );
  const stableBalances = useMemo(() => {
    void balanceKey;
    return balances;
  }, [balanceKey, balances]);

  const searching = query.trim().length > 0;

  const { tokens, loading: searchLoading } = useTokenSearch({
    query,
    excludeMint,
    balances: stableBalances,
    open: open && searching,
  });

  const { sections, loading: browseLoading } = useTokenBrowse({
    open,
    query,
    excludeMint,
    balances: stableBalances,
  });

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pick = (token: TokenAsset) => {
    if (!token.selectable) return;
    onSelect(token);
    onClose();
  };

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.title}>{title}</div>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.searchWrap}>
          <input
            className={styles.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={SWAP_COPY.searchPlaceholder}
            autoFocus
          />
        </div>

        <div className={styles.list}>
          {searching ? (
            searchLoading ? (
              <div className={styles.loading}>Searching…</div>
            ) : tokens.length === 0 ? (
              <div className={styles.empty}>{SWAP_COPY.noResults}</div>
            ) : (
              tokens.map((token) => (
                <TokenRow
                  key={token.mint || `soon-${token.symbol}`}
                  token={token}
                  onPick={pick}
                />
              ))
            )
          ) : browseLoading && sections.length === 0 ? (
            <div className={styles.loading}>Loading tokens…</div>
          ) : (
            sections.map((section) => (
              <div key={section.id} className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>{section.title}</div>
                  {section.unavailable ? (
                    <div className={styles.sectionNote}>
                      {SWAP_COPY.marketUnavailable}
                    </div>
                  ) : null}
                </div>
                {section.tokens.length === 0 && !section.unavailable ? (
                  <div className={styles.empty}>{SWAP_COPY.noResults}</div>
                ) : null}
                {section.tokens.map((token) => (
                  <TokenRow
                    key={`${section.id}-${token.mint || token.symbol}`}
                    token={token}
                    onPick={pick}
                    showMarket
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TokenRow({
  token,
  onPick,
  showMarket,
}: {
  token: TokenAsset;
  onPick: (token: TokenAsset) => void;
  showMarket?: boolean;
}) {
  const change = formatChangePct(token.priceChange24hPct);
  const volume = formatVolumeUsd(token.volume24hUsd);
  const changeClass =
    token.priceChange24hPct != null && token.priceChange24hPct >= 0
      ? styles.changeUp
      : styles.changeDown;

  return (
    <button
      type="button"
      className={styles.row}
      disabled={!token.selectable}
      onClick={() => onPick(token)}
    >
      <TokenIcon token={token} />
      <div className={styles.meta}>
        <div className={styles.symbolRow}>
          <span className={styles.symbol}>{token.symbol}</span>
          {token.warnings?.includes("unverified") ||
          token.warnings?.includes("unknown_metadata") ? (
            <span className={styles.tag}>{SWAP_COPY.unverified}</span>
          ) : null}
          {token.warnings?.includes("coming_soon") ? (
            <span className={`${styles.tag} ${styles.tagMuted}`}>
              {SWAP_COPY.comingSoon}
            </span>
          ) : null}
        </div>
        <div className={styles.name}>
          {token.name}
          {token.mint ? ` · ${shortMint(token.mint)}` : ""}
        </div>
      </div>
      <div className={styles.side}>
        {token.balanceUi != null ? (
          <div className={styles.bal}>
            {token.balanceUi.toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })}
          </div>
        ) : showMarket && change ? (
          <div className={changeClass}>{change}</div>
        ) : null}
        {showMarket && volume ? (
          <div className={styles.volume}>{volume}</div>
        ) : null}
        {!showMarket && token.warnings?.length
          ? token.warnings
              .filter((w) => w !== "unverified" && w !== "coming_soon")
              .map((w) => (
                <span key={w} className={styles.tag}>
                  {warningLabel(w)}
                </span>
              ))
          : null}
      </div>
    </button>
  );
}

function TokenIcon({ token }: { token: TokenAsset }) {
  if (isAxmToken(token) || token.symbol === "AXM") {
    return <BrandMark size={32} className={styles.icon} />;
  }
  if (token.iconUrl) {
    return (
      <img
        className={styles.icon}
        src={token.iconUrl}
        alt=""
        width={32}
        height={32}
        loading="lazy"
      />
    );
  }
  return <span className={styles.iconFallback} aria-hidden />;
}
