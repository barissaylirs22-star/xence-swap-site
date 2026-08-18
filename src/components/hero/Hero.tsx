import { HERO } from "@/content/copy";
import buttonStyles from "@/components/ui/Button.module.css";
import { AxiomOrb } from "@/components/visual/AxiomOrb";
import { ParticleField } from "@/components/visual/ParticleField";
import { HeroAtmosphere } from "./HeroAtmosphere";
import styles from "./Hero.module.css";

export function Hero() {
  return (
    <section className={`full-bleed ${styles.hero}`} aria-labelledby="brand-title">
      <div className={styles.particles}>
        <ParticleField count={64} />
      </div>
      <div className={styles.grid} aria-hidden />
      <HeroAtmosphere />

      <div className={styles.composition}>
        <div className={styles.orbLayer}>
          <div className={styles.orbGlow} aria-hidden />
          <AxiomOrb size="hero" />
        </div>

        <div className={styles.copy}>
          <div className={styles.badge}>
            <span className={styles.pulse} aria-hidden />
            {HERO.eyebrow}
          </div>

          <div className={styles.wordmark}>
            <h1 id="brand-title" className={styles.title}>
              {HERO.title}
            </h1>
            <span className={styles.symbol}>AXM</span>
          </div>

          <p className={styles.line}>{HERO.line}</p>

          <div className={styles.actions}>
            <a
              href="#journey"
              className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.large}`}
            >
              {HERO.ctaPrimary}
            </a>
            <a
              href="#community"
              className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.large}`}
            >
              {HERO.ctaSecondary}
            </a>
          </div>
        </div>
      </div>

      <div className={styles.scrollHint} aria-hidden>
        <span>Scroll</span>
        <span className={styles.scrollLine} />
      </div>
    </section>
  );
}
