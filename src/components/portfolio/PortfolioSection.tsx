import { PORTFOLIO } from "@/content/copy";
import { usePortfolio } from "@/hooks/usePortfolio";
import buttonStyles from "@/components/ui/Button.module.css";
import { BrandMark } from "@/components/visual/BrandMark";
import { truncateAddress } from "@/lib/explorers";
import { BRAND, getActiveMint } from "@/config/launch";
import type { PortfolioTokenRow } from "@/lib/portfolio/types";
import styles from "./PortfolioSection.module.css";

function isAxmHolding(row: PortfolioTokenRow): boolean {
  const live = getActiveMint();
  return Boolean(live && row.mint === live) || row.symbol === BRAND.symbol;
}

function TokenIcon({ row }: { row: PortfolioTokenRow }) {
  if (isAxmHolding(row)) {
    return <BrandMark size={22} className={styles.tokenMark} />;
  }
  if (row.iconUrl) {
    return (
      <img
        src={row.iconUrl}
        alt=""
        className={styles.tokenMark}
        width={22}
        height={22}
        onError={(event) => {
          (event.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return <span className={styles.tokenDot} aria-hidden />;
}

export function PortfolioSection() {
  const {
    status,
    owner,
    snapshot,
    message,
    walletError,
    connecting,
    connect,
    refresh,
  } = usePortfolio();

  const onConnect = () => {
    void connect("phantom").catch(() => {
      /* walletError surfaces below */
    });
  };

  return (
    <section
      id="portfolio"
      className={`full-bleed section sectionCompact ${styles.section}`}
      aria-labelledby="portfolio-title"
    >
      <div className="page">
        <header className={styles.intro}>
          <div className={styles.introRow}>
            <div>
              <p className={styles.eyebrow}>{PORTFOLIO.label}</p>
              <h2 id="portfolio-title" className={styles.heading}>
                {PORTFOLIO.title}
              </h2>
              <p className={styles.line}>{PORTFOLIO.line}</p>
            </div>
            {owner ? (
              <button
                type="button"
                className={`${buttonStyles.button} ${buttonStyles.secondary} ${styles.refresh}`}
                onClick={refresh}
                disabled={status === "loading"}
              >
                {PORTFOLIO.refresh}
              </button>
            ) : null}
          </div>
        </header>

        <div className={styles.panel}>
          {status === "disconnected" ? (
            <div className={styles.state}>
              <p>{PORTFOLIO.disconnected}</p>
              {walletError ? <p className={styles.warn}>{walletError}</p> : null}
              <button
                type="button"
                className={`${buttonStyles.button} ${buttonStyles.primary}`}
                onClick={onConnect}
                disabled={connecting}
              >
                {connecting ? "Connecting…" : PORTFOLIO.connect}
              </button>
            </div>
          ) : null}

          {status === "loading" ? (
            <div className={styles.state}>{PORTFOLIO.loading}</div>
          ) : null}

          {status === "unavailable" ? (
            <div className={styles.state}>
              <p className={styles.warn}>{message ?? PORTFOLIO.unavailable}</p>
            </div>
          ) : null}

          {snapshot && (status === "ready" || status === "empty") ? (
            <>
              <div className={styles.summary}>
                <div className={styles.summaryItem}>
                  <span className={styles.k}>{PORTFOLIO.wallet}</span>
                  <span className={styles.v} title={snapshot.owner}>
                    {truncateAddress(snapshot.owner, 6, 4)}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.k}>{PORTFOLIO.sol}</span>
                  <span className={`${styles.v} ${styles.mono}`}>
                    {snapshot.solUiAmount}
                  </span>
                </div>
              </div>

              {status === "empty" ? (
                <p className={styles.empty}>{PORTFOLIO.empty}</p>
              ) : (
                <ul className={styles.list}>
                  <li className={styles.listHead} aria-hidden>
                    <span>{PORTFOLIO.tokens}</span>
                    <span>{PORTFOLIO.amount}</span>
                  </li>
                  {snapshot.tokens.map((row) => (
                    <li key={row.mint} className={styles.row}>
                      <div className={styles.token}>
                        <TokenIcon row={row} />
                        <div className={styles.tokenCopy}>
                          <span className={styles.symbol}>
                            {row.symbol ?? truncateAddress(row.mint, 4, 4)}
                          </span>
                          <span className={styles.name}>
                            {row.name ?? row.mint}
                          </span>
                        </div>
                      </div>
                      <span className={`${styles.amount} ${styles.mono}`}>
                        {row.uiAmount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {message ? <p className={styles.note}>{message}</p> : null}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
