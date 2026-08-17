import { AxiomOrb } from "./AxiomOrb";
import styles from "./SectionOrb.module.css";

export function SectionOrb({
  side = "right",
}: {
  side?: "left" | "right" | "center";
}) {
  return (
    <div
      className={[
        styles.wrap,
        side === "left"
          ? styles.left
          : side === "center"
            ? styles.center
            : styles.right,
      ].join(" ")}
      aria-hidden
    >
      <AxiomOrb size="md" />
    </div>
  );
}
