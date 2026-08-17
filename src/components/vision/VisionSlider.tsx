import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CAROUSEL } from "@/content/copy";
import { useReveal } from "@/hooks/useReveal";
import { BrandMark } from "@/components/visual/BrandMark";
import styles from "./VisionSlider.module.css";

const GAP = 12;

function visibleCountForWidth(width: number): number {
  if (width >= 1024) return 3;
  if (width >= 720) return 2;
  return 1;
}

export function VisionSlider() {
  const { ref, visible } = useReveal<HTMLElement>();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);
  const [cardWidth, setCardWidth] = useState(300);
  const [visibleCount, setVisibleCount] = useState(1);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const origin = useRef(0);

  const maxIndex = Math.max(0, CAROUSEL.length - visibleCount);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const first = viewport?.querySelector<HTMLElement>("[data-card]");
    if (!viewport || !first) return;
    setCardWidth(first.offsetWidth);
    setVisibleCount(visibleCountForWidth(window.innerWidth));
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  useEffect(() => {
    setIndex((i) => Math.min(i, maxIndex));
  }, [maxIndex]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || dragging || maxIndex === 0) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i >= maxIndex ? 0 : i + 1));
    }, 5000);
    return () => window.clearInterval(id);
  }, [dragging, maxIndex]);

  const go = (dir: -1 | 1) => {
    setIndex((i) => {
      const next = i + dir;
      if (next < 0) return maxIndex;
      if (next > maxIndex) return 0;
      return next;
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true);
    startX.current = e.clientX;
    origin.current = dragX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragX(origin.current + (e.clientX - startX.current));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    const threshold = cardWidth * 0.18;
    if (dragX < -threshold) go(1);
    else if (dragX > threshold) go(-1);
    setDragX(0);
  };

  const base = -(index * (cardWidth + GAP));
  const tx = base + dragX;
  const progress =
    maxIndex === 0 ? 100 : ((index + visibleCount) / CAROUSEL.length) * 100;

  return (
    <section
      id="vision"
      ref={ref}
      className={`full-bleed section sectionImmersive ${styles.section} reveal ${visible ? "revealVisible" : ""}`}
      aria-labelledby="vision-title"
    >
      <div className={`page ${styles.shell}`}>
        <div className={styles.head}>
          <div>
            <div className="eyebrow">Signal</div>
            <h2 id="vision-title" className="display">
              The Axiom standard
            </h2>
          </div>
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.btn}
              aria-label="Previous"
              onClick={() => go(-1)}
            >
              ←
            </button>
            <button
              type="button"
              className={styles.btn}
              aria-label="Next"
              onClick={() => go(1)}
            >
              →
            </button>
          </div>
        </div>

        <div
          ref={viewportRef}
          className={[styles.viewport, dragging ? styles.viewportDragging : ""].join(
            " ",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className={[styles.track, dragging ? styles.trackInstant : ""].join(" ")}
            style={{ transform: `translate3d(${tx}px, 0, 0)` }}
          >
            {CAROUSEL.map((item, i) => (
              <article
                key={item.title}
                className={styles.card}
                data-card
                aria-hidden={i < index || i >= index + visibleCount}
              >
                <BrandMark size={30} className={styles.cardMark} />
                <div className={styles.index}>0{i + 1}</div>
                <h3 className={styles.title}>{item.title}</h3>
                <p className={styles.line}>{item.line}</p>
              </article>
            ))}
          </div>
        </div>

        <div className={styles.progress} aria-hidden>
          <div className={styles.bar} style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      </div>
    </section>
  );
}
