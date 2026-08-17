import { SOCIAL } from "@/config/site";
import { DISCLAIMER } from "@/content/copy";
import { BrandMark } from "@/components/visual/BrandMark";
import { AxiomOrb } from "@/components/visual/AxiomOrb";
import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.glow} aria-hidden />
      <div className={styles.orb} aria-hidden>
        <AxiomOrb size="md" />
      </div>
      <div className={`page ${styles.grid}`}>
        <div>
          <div className={styles.brandRow}>
            <BrandMark size={44} className={styles.mark} />
            <div className={styles.brand}>Axiom</div>
          </div>
          <p className={styles.blurb}>Pre-launch. Pump.fun next.</p>
          <p className={styles.disclaimer}>{DISCLAIMER}</p>
        </div>

        <div>
          <div className={styles.heading}>Navigate</div>
          <div className={styles.links}>
            <a className={styles.link} href="#journey">
              Journey
            </a>
            <a className={styles.link} href="#launch">
              Launch
            </a>
            <a className={styles.link} href="#trade">
              Trade
            </a>
            <a className={styles.link} href="#community">
              Community
            </a>
            <a
              className={`${styles.link} ${styles.external}`}
              href={SOCIAL.x}
              target="_blank"
              rel="noopener noreferrer"
            >
              X
            </a>
            <a
              className={`${styles.link} ${styles.external}`}
              href={SOCIAL.github}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
