import { AXIOM_LIVE } from "@/content/copy";
import { AxiomLivePanel } from "./AxiomLivePanel";
import styles from "./AxiomLiveSection.module.css";

/** Primary Discover surface — layout shell only; data lives in AxiomLivePanel. */
export function AxiomLiveSection() {
  return (
    <section
      id="live"
      className={`full-bleed section sectionCompact ${styles.section}`}
      aria-labelledby="live-title"
    >
      <div className="page">
        <header className={styles.intro}>
          <div className="eyebrow">{AXIOM_LIVE.title}</div>
          <h2 id="live-title" className={styles.heading}>
            {AXIOM_LIVE.sectionTitle}
          </h2>
          <p className={styles.line}>{AXIOM_LIVE.sectionLine}</p>
        </header>
        <AxiomLivePanel layout="primary" />
      </div>
    </section>
  );
}
