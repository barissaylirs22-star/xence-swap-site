import { useEffect, useState } from "react";
import { NAV_LINKS } from "@/config/site";
import buttonStyles from "@/components/ui/Button.module.css";
import { BrandMark } from "@/components/visual/BrandMark";
import { MobileNav } from "./MobileNav";
import styles from "./Header.module.css";

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <header
        className={[styles.header, scrolled ? styles.scrolled : ""].join(" ")}
      >
        <div className={`page ${styles.inner}`}>
          <a
            href="#top"
            className={styles.brand}
            aria-label="Axiom home"
            onClick={(event) => {
              event.preventDefault();
              const reduce = window.matchMedia(
                "(prefers-reduced-motion: reduce)",
              ).matches;
              // Replace any stale hash (e.g. #trade) so home always lands on top.
              window.history.replaceState(
                null,
                "",
                `${window.location.pathname}${window.location.search}#top`,
              );
              const top = document.getElementById("top");
              if (top) {
                top.scrollIntoView({
                  behavior: reduce ? "auto" : "smooth",
                  block: "start",
                });
              } else {
                window.scrollTo({
                  top: 0,
                  behavior: reduce ? "auto" : "smooth",
                });
              }
            }}
          >
            <BrandMark size={68} className={styles.mark} />
            <span className={styles.brandText}>
              <span className={styles.brandName}>Axiom</span>
              <span className={styles.brandMeta}>Pre-launch</span>
            </span>
          </a>

          <nav className={styles.nav} aria-label="Primary">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className={styles.link}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className={styles.actions}>
            <a
              href="#launch"
              className={`${styles.ctaDesktop} ${buttonStyles.button} ${buttonStyles.primary}`}
            >
              Launch
            </a>
            <button
              type="button"
              className={styles.menuBtn}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <span />
            </button>
          </div>
        </div>
      </header>

      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
