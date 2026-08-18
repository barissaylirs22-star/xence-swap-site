import styles from "./AxiomOrb.module.css";

type OrbSize = "sm" | "md" | "hero" | "xl";

interface AxiomOrbProps {
  size?: OrbSize;
  className?: string;
}

export function AxiomOrb({ size = "hero", className }: AxiomOrbProps) {
  const sizeClass =
    size === "sm"
      ? styles.sm
      : size === "md"
        ? styles.md
        : size === "xl"
          ? styles.xl
          : styles.hero;

  const imgSize = size === "sm" ? 96 : size === "md" ? 280 : 1024;
  const isHeroArtwork = size === "hero";

  return (
    <div
      className={[styles.stage, sizeClass, className ?? ""].filter(Boolean).join(" ")}
      aria-hidden
    >
      <div className={styles.halo} />

      <div className={styles.rings}>
        <svg className={styles.ringSvg} viewBox="0 0 100 100" aria-hidden>
          <circle
            className={`${styles.ringPath} ${styles.ringA}`}
            cx="50"
            cy="50"
            r="48"
          />
          <circle
            className={`${styles.ringPath} ${styles.ringB}`}
            cx="50"
            cy="50"
            r="42"
          />
          <circle
            className={`${styles.ringPath} ${styles.ringC}`}
            cx="50"
            cy="50"
            r="36"
          />
        </svg>
      </div>

      <span className={styles.satellite} />

      <div className={styles.coreWrap}>
        <div className={styles.core}>
          <img
            src={isHeroArtwork ? "/assets/ax-hero.png" : "/assets/axm-mark.png"}
            srcSet={
              isHeroArtwork
                ? undefined
                : "/assets/axm-mark-512.png 512w, /assets/axm-mark.png 1024w"
            }
            sizes={
              size === "sm"
                ? "72px"
                : size === "md"
                  ? "280px"
                  : "(min-width: 1024px) 380px, 62vw"
            }
            width={imgSize}
            height={imgSize}
            alt=""
            decoding="async"
            draggable={false}
          />
          <div className={styles.shine} />
        </div>
      </div>
    </div>
  );
}
