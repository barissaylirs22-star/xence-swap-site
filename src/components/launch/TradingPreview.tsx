import { TRADING_PREVIEW } from "@/content/copy";
import { useReveal } from "@/hooks/useReveal";
import { BrandMark } from "@/components/visual/BrandMark";
import { AxiomSwap } from "@/components/swap/AxiomSwap";
import { canExecuteSwaps } from "@/lib/swap/gate";
import styles from "./TradingPreview.module.css";

/**
 * Trading section — general-purpose Axiom Swap terminal.
 * AXM availability is controlled separately via launch.ts.
 */
export function TradingPreview() {
  const { ref, visible } = useReveal<HTMLElement>();
  const executionOn = canExecuteSwaps();

  return (
    <section
      id="trade"
      ref={ref}
      className={`full-bleed section sectionCompact reveal ${visible ? "revealVisible" : ""}`}
      aria-labelledby="trade-title"
    >
      <div className="page">
        <div className={styles.shell}>
          <div className={styles.head}>
            <div className={styles.headBrand}>
              <BrandMark size={36} className={styles.headMark} />
              <div>
                <div className="eyebrow">{TRADING_PREVIEW.label}</div>
                <h2 id="trade-title" className={styles.title}>
                  {TRADING_PREVIEW.title}
                </h2>
                <p className={styles.note}>{TRADING_PREVIEW.line}</p>
              </div>
            </div>
            {!executionOn ? <div className={styles.badge}>Preview</div> : null}
          </div>

          <AxiomSwap />
        </div>
      </div>
    </section>
  );
}
