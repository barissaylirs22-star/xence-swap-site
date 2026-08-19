import { SWAP_COPY } from "@/content/swap";
import buttonStyles from "@/components/ui/Button.module.css";
import { fromRawAmount } from "@/lib/swap/amounts";
import { normalizeImpactPercent } from "@/lib/swap/priceImpact";
import { truncateAddress } from "@/lib/explorers";
import { shortMint } from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";
import type { SwapQuote } from "@/lib/swap/types";
import styles from "./SwapConfirmModal.module.css";

export interface SwapConfirmDetails {
  payToken: TokenAsset;
  receiveToken: TokenAsset;
  payAmount: string;
  quote: SwapQuote;
}

interface SwapConfirmModalProps {
  open: boolean;
  details: SwapConfirmDetails | null;
  executionEnabled: boolean;
  confirming: boolean;
  statusMessage: string | null;
  /** Present after broadcast — not a success signal by itself. */
  pendingSignature?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

function formatImpact(value: number | null): string {
  const pct = normalizeImpactPercent(value);
  if (pct === null) return "—";
  return `${pct.toFixed(pct < 0.01 ? 4 : 2)}%`;
}

function busyButtonLabel(statusMessage: string | null): string {
  if (!statusMessage) return SWAP_COPY.pending;
  if (statusMessage === SWAP_COPY.submitted) return SWAP_COPY.submitted;
  if (statusMessage === SWAP_COPY.confirmingOnchain) {
    return SWAP_COPY.confirmingOnchain;
  }
  if (statusMessage === SWAP_COPY.pending) return SWAP_COPY.pending;
  return statusMessage;
}

export function SwapConfirmModal({
  open,
  details,
  executionEnabled,
  confirming,
  statusMessage,
  pendingSignature = null,
  onCancel,
  onConfirm,
}: SwapConfirmModalProps) {
  if (!open || !details) return null;

  const { payToken, receiveToken, payAmount, quote } = details;
  const estimated =
    receiveToken.decimals !== null
      ? fromRawAmount(quote.outAmountRaw, receiveToken.decimals)
      : "—";
  const minOut =
    receiveToken.decimals !== null
      ? fromRawAmount(quote.minOutAmountRaw, receiveToken.decimals)
      : "—";

  const showProgress =
    confirming &&
    (statusMessage === SWAP_COPY.submitted ||
      statusMessage === SWAP_COPY.confirmingOnchain ||
      statusMessage === SWAP_COPY.pending ||
      statusMessage === SWAP_COPY.preparing ||
      statusMessage === SWAP_COPY.quoting);

  return (
    <div className={styles.backdrop} role="presentation" onClick={onCancel}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={SWAP_COPY.confirmTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.title}>{SWAP_COPY.confirmTitle}</div>
          <button
            type="button"
            className={styles.close}
            onClick={onCancel}
            disabled={confirming}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.row}>
            <span>{SWAP_COPY.youPay}</span>
            <strong>
              {payAmount} {payToken.symbol}
            </strong>
          </div>
          <div className={styles.row}>
            <span>{SWAP_COPY.youReceive}</span>
            <strong>
              ~{estimated} {receiveToken.symbol}
            </strong>
          </div>
          <div className={styles.row}>
            <span>{SWAP_COPY.minReceived}</span>
            <strong>
              {minOut} {receiveToken.symbol}
            </strong>
          </div>
          <div className={styles.row}>
            <span>{SWAP_COPY.priceImpact}</span>
            <strong>{formatImpact(quote.priceImpactPct)}</strong>
          </div>
          <div className={styles.row}>
            <span>{SWAP_COPY.slippage}</span>
            <strong>{(quote.slippageBps / 100).toFixed(2)}%</strong>
          </div>
          <div className={styles.row}>
            <span>{SWAP_COPY.route}</span>
            <strong>{quote.routeSummary}</strong>
          </div>
          <div className={styles.row}>
            <span>{SWAP_COPY.token}</span>
            <strong>{receiveToken.symbol}</strong>
          </div>
          <div className={styles.row}>
            <span>{SWAP_COPY.mint}</span>
            <strong className={styles.mono}>
              {shortMint(receiveToken.mint)}
            </strong>
          </div>
          <div className={styles.row}>
            <span>{SWAP_COPY.network}</span>
            <strong>{SWAP_COPY.networkMainnet}</strong>
          </div>
        </div>

        {!executionEnabled ? (
          <div className={styles.gateNote}>{SWAP_COPY.confirmGated}</div>
        ) : (
          <div className={styles.gateNote}>
            Phantom will open only after you press Confirm Swap.
          </div>
        )}

        {showProgress ? (
          <div className={styles.progress} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden />
            <div className={styles.progressText}>
              <div>{statusMessage}</div>
              {pendingSignature ? (
                <div className={styles.progressSig}>
                  {SWAP_COPY.signature}:{" "}
                  <span className={styles.mono}>
                    {truncateAddress(pendingSignature, 6, 6)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : statusMessage ? (
          <div className={styles.status} role="status">
            {statusMessage}
          </div>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={`${buttonStyles.button} ${buttonStyles.secondary} ${buttonStyles.block}`}
            onClick={onCancel}
            disabled={confirming}
          >
            {SWAP_COPY.cancel}
          </button>
          <button
            type="button"
            className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.block} ${styles.confirmCta}`}
            onClick={onConfirm}
            disabled={confirming || !executionEnabled}
          >
            {confirming
              ? busyButtonLabel(statusMessage)
              : SWAP_COPY.confirmSwap}
          </button>
        </div>
      </div>
    </div>
  );
}
