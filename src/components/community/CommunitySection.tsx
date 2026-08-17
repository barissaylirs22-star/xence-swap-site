import { SOCIAL } from "@/config/site";
import { COMMUNITY } from "@/content/copy";
import { useReveal } from "@/hooks/useReveal";
import { BrandMark } from "@/components/visual/BrandMark";
import styles from "./CommunitySection.module.css";

const LINKS = [
  ...(SOCIAL.x
    ? [
        {
          platform: "Social",
          name: "X",
          meta: "Official updates",
          href: SOCIAL.x,
          featured: true,
        } as const,
      ]
    : []),
  {
    platform: "Source",
    name: "GitHub",
    meta: "Axiom site",
    href: SOCIAL.github,
    featured: false,
  },
] as const;

export function CommunitySection() {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section
      id="community"
      ref={ref}
      className={`full-bleed section sectionCompact reveal ${visible ? "revealVisible" : ""}`}
      aria-labelledby="community-title"
    >
      <div className={`page ${styles.inner}`}>
        <div className={styles.head}>
          <BrandMark size={36} className={styles.headMark} />
          <div>
            <div className="eyebrow">{COMMUNITY.label}</div>
            <h2 id="community-title" className="display">
              {COMMUNITY.title}
            </h2>
          </div>
        </div>

        <div className={styles.grid}>
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={[styles.card, link.featured ? styles.featured : ""].join(
                " ",
              )}
            >
              <div>
                <div className={styles.platform}>{link.platform}</div>
                <div className={styles.name}>{link.name}</div>
                <div className={styles.meta}>{link.meta}</div>
              </div>
              <div className={styles.arrow} aria-hidden>
                ↗
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
