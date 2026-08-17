import { useCopyMint } from "@/hooks/useCopyMint";
import styles from "./CopyButton.module.css";

interface CopyButtonProps {
  mint?: string | null;
  label?: string;
}

/** Only useful after a live mint is configured. */
export function CopyButton({ mint, label = "Copy mint" }: CopyButtonProps) {
  const { copied, copy, mint: value } = useCopyMint(mint);

  return (
    <button
      type="button"
      className={[styles.copy, copied ? styles.copied : ""].join(" ")}
      onClick={() => void copy()}
      disabled={!value}
      aria-live="polite"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
