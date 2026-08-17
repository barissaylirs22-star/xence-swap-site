import styles from "./AmbientBackground.module.css";

export function AmbientBackground() {
  return (
    <div className={styles.root} aria-hidden>
      <div className={`${styles.orb} ${styles.a}`} />
      <div className={`${styles.orb} ${styles.b}`} />
      <div className={`${styles.orb} ${styles.c}`} />
      <div className={styles.texture} />
      <div className={styles.veil} />
    </div>
  );
}
