import buttonStyles from "@/components/ui/Button.module.css";
import styles from "./StickyLaunchCta.module.css";

export function StickyLaunchCta() {
  return (
    <div className={styles.bar}>
      <a
        href="#launch"
        className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.block}`}
      >
        Follow the launch
      </a>
    </div>
  );
}
