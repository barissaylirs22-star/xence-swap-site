import { JOURNEY } from "@/content/copy";
import { useReveal } from "@/hooks/useReveal";
import { BrandMark } from "@/components/visual/BrandMark";
import styles from "./JourneySection.module.css";

export function JourneySection() {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section
      id="journey"
      ref={ref}
      className={`full-bleed section sectionCompact reveal ${visible ? "revealVisible" : ""}`}
      aria-labelledby="journey-title"
    >
      <div className={`page ${styles.inner}`}>
        <div className={styles.head}>
          <BrandMark size={36} className={styles.headMark} />
          <div>
            <div className="eyebrow">Ecosystem</div>
            <h2 id="journey-title" className="display">
              Launch journey
            </h2>
          </div>
        </div>

        <div className={styles.rail}>
          {JOURNEY.map((item) => (
            <article
              key={item.step}
              className={[
                styles.step,
                item.detail === "Next" || item.detail === "Soon"
                  ? styles.next
                  : "",
              ].join(" ")}
            >
              <div className={styles.num}>{item.step}</div>
              <h3 className={styles.title}>{item.title}</h3>
              <p className={styles.detail}>{item.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
