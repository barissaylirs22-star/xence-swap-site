import { NAV_LINKS } from "@/config/site";
import buttonStyles from "@/components/ui/Button.module.css";
import styles from "./MobileNav.module.css";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNav({ open, onClose }: MobileNavProps) {
  return (
    <>
      <div
        className={[styles.overlay, open ? styles.overlayOpen : ""].join(" ")}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={[styles.sheet, open ? styles.sheetOpen : ""].join(" ")}
        aria-hidden={!open}
        aria-label="Mobile navigation"
      >
        <div className={styles.top}>
          <span className={styles.title}>Menu</span>
          <button
            type="button"
            className={styles.close}
            aria-label="Close menu"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <nav className={styles.links}>
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={styles.link}
              onClick={onClose}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className={styles.footer}>
          <a
            href="#launch"
            onClick={onClose}
            className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.block}`}
          >
            Follow the launch
          </a>
        </div>
      </aside>
    </>
  );
}
