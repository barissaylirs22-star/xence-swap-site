import {
  getActiveMint,
  getPumpFunUrl,
  isLaunchLive,
  LAUNCH,
} from "@/config/launch";
import { LAUNCH_SECTION } from "@/content/copy";
import { useReveal } from "@/hooks/useReveal";
import { useCopyMint } from "@/hooks/useCopyMint";
import buttonStyles from "@/components/ui/Button.module.css";
import { BrandMark } from "@/components/visual/BrandMark";
import { solanaExplorerTokenUrl, solscanTokenUrl } from "@/lib/explorers";
import styles from "./LaunchSection.module.css";

function LiveActions() {
  const mint = getActiveMint();
  const pumpUrl = getPumpFunUrl();
  const { copied, copy } = useCopyMint(mint);
  const solscan = solscanTokenUrl(mint);
  const explorer = solanaExplorerTokenUrl(mint);

  return (
    <div>
      {mint ? <div className={styles.mint}>{mint}</div> : null}
      <div className={styles.liveRow}>
        <button
          type="button"
          className={`${buttonStyles.button} ${buttonStyles.secondary}`}
          onClick={() => void copy()}
          disabled={!mint}
        >
          {copied ? "Copied" : "Copy address"}
        </button>
        {pumpUrl ? (
          <a
            href={pumpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
          >
            Open Pump.fun ↗
          </a>
        ) : null}
        {solscan ? (
          <a
            href={solscan}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonStyles.button} ${buttonStyles.ghost}`}
          >
            Solscan ↗
          </a>
        ) : null}
        {explorer ? (
          <a
            href={explorer}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonStyles.button} ${buttonStyles.ghost}`}
          >
            Explorer ↗
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function LaunchSection() {
  const { ref, visible } = useReveal<HTMLElement>();
  const live = isLaunchLive();

  return (
    <section
      id="launch"
      ref={ref}
      className={`full-bleed section sectionCompact reveal ${visible ? "revealVisible" : ""}`}
      aria-labelledby="launch-title"
    >
      <div className="page">
        <div className={styles.module}>
          <BrandMark size={48} className={styles.mark} />

          <div className={styles.copy}>
            {!live ? (
              <div className={styles.status}>
                <span className={styles.statusDot} aria-hidden />
                {LAUNCH_SECTION.status}
              </div>
            ) : (
              <div
                className={styles.status}
                style={{ color: "var(--accent-strong)" }}
              >
                <span
                  className={styles.statusDot}
                  style={{ background: "var(--accent-strong)" }}
                  aria-hidden
                />
                Live on {LAUNCH.platform}
              </div>
            )}
            <h2 id="launch-title" className={styles.title}>
              {LAUNCH_SECTION.title}
            </h2>
            <p className={styles.line}>{LAUNCH_SECTION.line}</p>
            {!live ? (
              <p className={styles.support}>{LAUNCH_SECTION.support}</p>
            ) : (
              <LiveActions />
            )}
          </div>

          {!live ? (
            <a
              href="#community"
              className={`${styles.cta} ${buttonStyles.button} ${buttonStyles.secondary}`}
            >
              Follow updates
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}
