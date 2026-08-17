import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SLIPPAGE_BPS } from "@/config/providers";
import { SWAP_COPY } from "@/content/swap";
import { useSwapQuote } from "@/hooks/useSwapQuote";
import { BrandMark } from "@/components/visual/BrandMark";
import buttonStyles from "@/components/ui/Button.module.css";
import { fromRawAmount } from "@/lib/swap/amounts";
import { fetchTokenUiBalance } from "@/lib/swap/balances";
import { confirmAndExecuteSwap } from "@/lib/swap/confirmExecute";
import { canExecuteSwaps, canFetchQuotes } from "@/lib/swap/gate";
import {
  classifyPriceImpact,
  normalizeImpactPercent,
} from "@/lib/swap/priceImpact";
import { quoteMatchesDisplayedPair } from "@/lib/swap/pairGuard";
import { assessSwapReadiness } from "@/lib/swap/readiness";
import {
  clampSlippageBps,
  parseSlippagePercentInput,
} from "@/lib/swap/slippage";
import {
  getMaxSpendableUi,
  sanitizeAmountInput,
  validatePayAmount,
} from "@/lib/swap/spendable";
import {
  acquireSwapSubmitLock,
  isSwapSubmitLocked,
  releaseSwapSubmitLock,
} from "@/lib/swap/submitLock";
import { useSwapIntent } from "@/lib/swap/useSwapIntent";
import { getDefaultSwapPair } from "@/lib/swap/tokens";
import type { SwapSide } from "@/lib/swap/types";
import { isAxmToken } from "@/lib/tokens/axm";
import { hydrateTokenForSwap } from "@/lib/tokens/hydrate";
import {
  getDefaultPayToken,
  getDefaultReceiveToken,
} from "@/lib/tokens/catalog";
import type { TokenAsset } from "@/lib/tokens/types";
import { solscanTxUrl, truncateAddress } from "@/lib/explorers";
import { useWallet } from "@/lib/wallet/useWallet";
import { SwapConfirmModal, type SwapConfirmDetails } from "./SwapConfirmModal";
import { TokenSelector } from "./TokenSelector";
import styles from "./AxiomSwap.module.css";

const SLIPPAGE_PRESETS = [50, 100, 150] as const;

function formatImpact(value: number | null): string {
  const pct = normalizeImpactPercent(value);
  if (pct === null) return "—";
  return `${pct.toFixed(pct < 0.01 ? 4 : 2)}%`;
}

function shortKey(key: string): string {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export function AxiomSwap() {
  const executionOn = canExecuteSwaps();
  const quotesOn = canFetchQuotes();
  const { intent, consumeIntent } = useSwapIntent();
  const { wallet, connecting, connect, disconnect, error: walletError, clearError } =
    useWallet();

  const defaults = useMemo(() => getDefaultSwapPair(), []);
  const [payToken, setPayToken] = useState<TokenAsset>(defaults.base);
  const [receiveToken, setReceiveToken] = useState<TokenAsset>(defaults.quote);
  const [payAmount, setPayAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [payBalance, setPayBalance] = useState<number | null>(null);
  const [receiveBalance, setReceiveBalance] = useState<number | null>(null);
  const [balanceUnavailable, setBalanceUnavailable] = useState(false);
  const [selectorSide, setSelectorSide] = useState<SwapSide | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDetails, setConfirmDetails] =
    useState<SwapConfirmDetails | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<string | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const [quoteResetKey, setQuoteResetKey] = useState(0);
  const [balanceTick, setBalanceTick] = useState(0);
  const [success, setSuccess] = useState<{
    signature: string;
    confirmed: boolean;
    payAmount: string;
    paySymbol: string;
    receiveAmount: string;
    receiveSymbol: string;
  } | null>(null);

  useEffect(() => {
    if (!intent) return;

    const controller = new AbortController();
    const liveMint = intent.token.mint;

    void (async () => {
      const hydrated = await hydrateTokenForSwap(intent.token, controller.signal);
      if (controller.signal.aborted) return;

      // Preserve the exact LIVE mint — never substitute another token.
      if (hydrated.mint !== liveMint) {
        consumeIntent();
        return;
      }

      const sol = getDefaultPayToken();
      setPayToken(sol);
      setSelectorSide(null);
      setConfirmOpen(false);
      setConfirmDetails(null);

      if (!hydrated.selectable || !hydrated.mint || hydrated.mint === sol.mint) {
        setReceiveToken(getDefaultReceiveToken());
      } else {
        setReceiveToken({ ...hydrated, mint: liveMint });
      }

      consumeIntent();
    })();

    return () => controller.abort();
  }, [intent, consumeIntent]);

  useEffect(() => {
    if (!wallet) {
      setPayBalance(null);
      setReceiveBalance(null);
      setBalanceUnavailable(false);
      return;
    }

    const controller = new AbortController();

    const load = async (
      token: TokenAsset,
      set: (n: number | null) => void,
    ) => {
      if (!token.mint || token.decimals === null) {
        set(null);
        return "skipped" as const;
      }
      const result = await fetchTokenUiBalance({
        owner: wallet.publicKey,
        mint: token.mint,
        decimals: token.decimals,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return "skipped" as const;
      set(result.status === "ok" ? (result.uiAmount ?? 0) : null);
      return result.status;
    };

    void (async () => {
      const payStatus = await load(payToken, setPayBalance);
      await load(receiveToken, setReceiveBalance);
      if (!controller.signal.aborted) {
        setBalanceUnavailable(payStatus === "unavailable");
      }
    })();

    return () => controller.abort();
  }, [wallet, payToken, receiveToken, balanceTick]);

  const { quote, loading: quoting, error: quoteError, fresh } = useSwapQuote({
    payToken,
    receiveToken,
    payAmount,
    slippageBps,
    enabled: quotesOn,
    resetKey: quoteResetKey,
  });

  const amountCheck = validatePayAmount({
    amount: payAmount,
    token: payToken,
    balanceUi: payBalance,
    walletConnected: Boolean(wallet),
  });

  const mintAligned = quoteMatchesDisplayedPair(
    quote,
    payToken.mint,
    receiveToken.mint,
  );

  const readiness = assessSwapReadiness({
    wallet,
    payToken,
    receiveToken,
    payAmount,
    payBalanceUi: payBalance,
    quote: fresh && mintAligned ? quote : null,
    quoting,
    quoteError,
  });

  const receiveAmount =
    quote && fresh && mintAligned && receiveToken.decimals !== null
      ? fromRawAmount(quote.outAmountRaw, receiveToken.decimals)
      : "";

  const impactLevel = classifyPriceImpact(quote?.priceImpactPct ?? null);
  const unverifiedPair =
    Boolean(payToken.warnings?.includes("unverified")) ||
    Boolean(receiveToken.warnings?.includes("unverified")) ||
    Boolean(payToken.warnings?.includes("unknown_metadata")) ||
    Boolean(receiveToken.warnings?.includes("unknown_metadata"));

  const canReview =
    Boolean(wallet) &&
    amountCheck.ok &&
    Boolean(quote) &&
    fresh &&
    mintAligned &&
    readiness.quoteReady &&
    !quoting &&
    !confirming &&
    !isSwapSubmitLocked();

  // Close confirmation if the pair becomes unsafe (never while confirming).
  useEffect(() => {
    if (!confirmOpen || confirming) return;
    if (!quote || !fresh || !mintAligned) {
      setConfirmOpen(false);
      setConfirmDetails(null);
      if (!success) setConfirmStatus(SWAP_COPY.staleQuote);
    }
  }, [confirmOpen, confirming, quote, fresh, mintAligned, success]);

  const statusText = (() => {
    if (success) return null;
    if (walletError) return walletError;
    if (wallet && balanceUnavailable) return SWAP_COPY.balanceUnavailable;
    if (
      amountCheck.ok === false &&
      payAmount.trim() &&
      (amountCheck.issue === "insufficient" ||
        amountCheck.issue === "sol_reserve" ||
        amountCheck.issue === "invalid")
    ) {
      if (amountCheck.issue === "insufficient") return SWAP_COPY.insufficient;
      if (amountCheck.issue === "sol_reserve") return SWAP_COPY.solReserve;
      return SWAP_COPY.invalidAmount;
    }
    if (quoting) return SWAP_COPY.quoting;
    if (quoteError) return quoteError;
    if (confirmStatus && !confirmOpen) return confirmStatus;
    if (readiness.publicMessage) return readiness.publicMessage;
    if (!wallet) return SWAP_COPY.disconnected;
    return null;
  })();

  const statusWarn =
    Boolean(walletError) ||
    balanceUnavailable ||
    Boolean(quoteError) ||
    (amountCheck.ok === false &&
      payAmount.trim().length > 0 &&
      amountCheck.issue !== "empty" &&
      amountCheck.issue !== "zero") ||
    readiness.blockers.includes("stale_quote") ||
    readiness.blockers.includes("insufficient_balance") ||
    readiness.blockers.includes("sol_reserve") ||
    (Boolean(confirmStatus) && !confirmOpen && !success);

  const flip = () => {
    setPayToken(receiveToken);
    setReceiveToken(payToken);
    setPayAmount(receiveAmount && receiveAmount !== "—" ? receiveAmount : "");
    setConfirmOpen(false);
  };

  const onConnect = async () => {
    clearError();
    try {
      await connect("phantom");
    } catch {
      /* walletError status line */
    }
  };

  const openConfirm = () => {
    if (!wallet || !quote || !canReview || confirming) return;
    setSuccess(null);
    setConfirmStatus(null);
    setPendingSignature(null);
    setConfirmDetails({
      payToken,
      receiveToken,
      payAmount,
      quote,
    });
    setConfirmOpen(true);
  };

  const onPrimary = () => {
    if (!wallet) {
      void onConnect();
      return;
    }
    openConfirm();
  };

  const onConfirmSwap = () => {
    if (confirming || isSwapSubmitLocked()) {
      setConfirmStatus(SWAP_COPY.submitInFlight);
      return;
    }

    if (!wallet || !confirmDetails) {
      setConfirmStatus(SWAP_COPY.disconnected);
      setConfirmOpen(false);
      return;
    }

    if (!executionOn) {
      setConfirmStatus(SWAP_COPY.swapDisabled);
      return;
    }

    const owner = `ui:${wallet.publicKey}:${Date.now()}`;
    if (!acquireSwapSubmitLock(owner)) {
      setConfirmStatus(SWAP_COPY.submitInFlight);
      return;
    }

    setConfirming(true);
    setConfirmStatus(SWAP_COPY.preparing);
    setPendingSignature(null);
    setSuccess(null);

    void (async () => {
      try {
        const outcome = await confirmAndExecuteSwap({
          wallet,
          payToken,
          receiveToken,
          payAmount: confirmDetails.payAmount,
          payBalanceUi: payBalance,
          slippageBps,
          reviewedQuote: confirmDetails.quote,
          onPhase: (phase, detail) => {
            if (phase === "wallet") {
              setConfirmStatus(SWAP_COPY.pending);
            } else if (phase === "submitted") {
              if (detail?.signature) setPendingSignature(detail.signature);
              setConfirmStatus(SWAP_COPY.submitted);
            } else if (phase === "confirming") {
              if (detail?.signature) setPendingSignature(detail.signature);
              setConfirmStatus(SWAP_COPY.confirmingOnchain);
            } else if (phase === "quote") {
              setConfirmStatus(SWAP_COPY.quoting);
            } else {
              setConfirmStatus(SWAP_COPY.preparing);
            }
          },
        });

        if (outcome.status === "needs_reconfirm") {
          setConfirmDetails({
            ...confirmDetails,
            quote: outcome.quote,
          });
          setConfirmStatus(outcome.message);
          setPendingSignature(null);
          return;
        }

        if (outcome.status === "error") {
          setConfirmStatus(outcome.message);
          return;
        }

        // Safety: never show success from sign/broadcast alone.
        if (!outcome.result.confirmed || !outcome.result.signature) {
          setConfirmStatus(SWAP_COPY.failure);
          return;
        }

        const received =
          receiveToken.decimals !== null
            ? fromRawAmount(
                outcome.quote.outAmountRaw,
                receiveToken.decimals,
              )
            : "—";

        setSuccess({
          signature: outcome.result.signature,
          confirmed: true,
          payAmount: confirmDetails.payAmount,
          paySymbol: payToken.symbol,
          receiveAmount: received,
          receiveSymbol: receiveToken.symbol,
        });
        setConfirmOpen(false);
        setConfirmDetails(null);
        setConfirmStatus(null);
        setPendingSignature(null);
        // Clear amount + quote so prior tx/quote cannot be reused.
        setPayAmount("");
        setQuoteResetKey((n) => n + 1);
        setBalanceTick((n) => n + 1);
      } finally {
        setConfirming(false);
        releaseSwapSubmitLock(owner);
      }
    })();
  };

  const balances = useMemo(() => {
    const map: Record<string, number | null> = {};
    if (payToken.mint) map[payToken.mint] = payBalance;
    if (receiveToken.mint) map[receiveToken.mint] = receiveBalance;
    return map;
  }, [payToken.mint, receiveToken.mint, payBalance, receiveBalance]);

  const onSelectToken = (token: TokenAsset) => {
    if (!token.selectable || !token.mint) return;
    const side = selectorSide;
    void (async () => {
      const hydrated = await hydrateTokenForSwap(token);
      if (!hydrated.selectable || !hydrated.mint) return;
      setConfirmOpen(false);
      if (side === "pay") {
        if (hydrated.mint === receiveToken.mint) setReceiveToken(payToken);
        setPayToken(hydrated);
      } else if (side === "receive") {
        if (hydrated.mint === payToken.mint) setPayToken(receiveToken);
        setReceiveToken(hydrated);
      }
    })();
  };

  const spendable = getMaxSpendableUi(payToken, payBalance);

  const applyMax = () => {
    if (spendable === null || spendable <= 0) return;
    const decimals = payToken.decimals ?? 9;
    const fixed = spendable.toFixed(Math.min(decimals, 6));
    setPayAmount(sanitizeAmountInput(fixed.replace(/\.?0+$/, "") || "0"));
  };

  const primaryLabel = !wallet
    ? connecting
      ? "Connecting…"
      : SWAP_COPY.connect
    : SWAP_COPY.swap;

  const primaryDisabled =
    connecting || (!!wallet && (!canReview || confirming));

  return (
    <div className={styles.root}>
      <div className={styles.banner}>
        <div className={styles.bannerText}>
          <div className={styles.bannerTitle}>{SWAP_COPY.previewTitle}</div>
          <p className={styles.bannerHint}>{SWAP_COPY.previewHint}</p>
        </div>
        <div className={styles.badge}>
          {executionOn ? "Mainnet" : "Preview"}
        </div>
      </div>

      {success?.confirmed ? (
        <div className={styles.successCard} role="status">
          <div className={styles.successTitle}>{SWAP_COPY.success}</div>
          <div className={styles.successRow}>
            <span>{SWAP_COPY.amountPaid}</span>
            <strong>
              {success.payAmount} {success.paySymbol}
            </strong>
          </div>
          <div className={styles.successRow}>
            <span>{SWAP_COPY.amountReceived}</span>
            <strong>
              ~{success.receiveAmount} {success.receiveSymbol}
            </strong>
          </div>
          <div className={styles.successRow}>
            <span>{SWAP_COPY.signature}</span>
            <strong className={styles.mono}>
              {truncateAddress(success.signature, 6, 6)}
            </strong>
          </div>
          <div className={styles.successRow}>
            <span>Status</span>
            <strong className={styles.successState}>{SWAP_COPY.confirmed}</strong>
          </div>
          <a
            className={styles.successLink}
            href={solscanTxUrl(success.signature)}
            target="_blank"
            rel="noreferrer"
          >
            {SWAP_COPY.viewTransaction}
          </a>
        </div>
      ) : null}

      <div className={styles.stack}>
        <div className={styles.field}>
          <div className={styles.fieldTop}>
            <span className={styles.label}>{SWAP_COPY.youPay}</span>
            <span className={styles.balance}>
              {SWAP_COPY.balance}:{" "}
              {payBalance === null
                ? "—"
                : payBalance.toLocaleString(undefined, {
                    maximumFractionDigits: 4,
                  })}
              {wallet && spendable !== null ? (
                <button
                  type="button"
                  className={styles.maxBtn}
                  onClick={applyMax}
                  disabled={spendable <= 0}
                >
                  {SWAP_COPY.max}
                </button>
              ) : null}
            </span>
          </div>
          <div className={styles.fieldMain}>
            <input
              className={styles.amount}
              inputMode="decimal"
              placeholder="0.0"
              value={payAmount}
              onChange={(e) => {
                setPayAmount(sanitizeAmountInput(e.target.value));
              }}
              aria-label={SWAP_COPY.youPay}
            />
            <TokenChip
              token={payToken}
              onClick={() => setSelectorSide("pay")}
            />
          </div>
        </div>

        <div className={styles.flipWrap}>
          <button
            type="button"
            className={styles.flip}
            onClick={flip}
            aria-label="Switch tokens"
          >
            ↕
          </button>
        </div>

        <div className={styles.field}>
          <div className={styles.fieldTop}>
            <span className={styles.label}>{SWAP_COPY.youReceive}</span>
            <span className={styles.balance}>{SWAP_COPY.estimated}</span>
          </div>
          <div className={styles.fieldMain}>
            <input
              className={styles.amount}
              value={receiveAmount}
              placeholder="0.0"
              disabled
              readOnly
              aria-label={SWAP_COPY.youReceive}
            />
            <TokenChip
              token={receiveToken}
              onClick={() => setSelectorSide("receive")}
            />
          </div>
        </div>
      </div>

      <div className={styles.details} aria-live="polite">
        <div className={styles.row}>
          <span>{SWAP_COPY.priceImpact}</span>
          <strong
            className={
              impactLevel === "high"
                ? styles.impactHigh
                : impactLevel === "elevated"
                  ? styles.impactElevated
                  : undefined
            }
          >
            {!quote || !fresh || !mintAligned
              ? "—"
              : formatImpact(quote.priceImpactPct)}
          </strong>
        </div>
        <div className={styles.row}>
          <span>{SWAP_COPY.minReceived}</span>
          <strong>
            {!quote || !fresh || !mintAligned || receiveToken.decimals === null
              ? "—"
              : `${fromRawAmount(quote.minOutAmountRaw, receiveToken.decimals)} ${receiveToken.symbol}`}
          </strong>
        </div>
        <div className={styles.row}>
          <span>{SWAP_COPY.route}</span>
          <strong>
            {!quote || !fresh || !mintAligned ? "—" : quote.routeSummary}
          </strong>
        </div>
        <div className={styles.slippageRow}>
          <span>{SWAP_COPY.slippage}</span>
          <div className={styles.slippageControls}>
            {SLIPPAGE_PRESETS.map((bps) => (
              <button
                key={bps}
                type="button"
                className={[
                  styles.chip,
                  slippageBps === bps ? styles.chipActive : "",
                ].join(" ")}
                onClick={() => setSlippageBps(bps)}
              >
                {(bps / 100).toFixed(1)}%
              </button>
            ))}
            <button
              type="button"
              className={[
                styles.chip,
                !SLIPPAGE_PRESETS.includes(
                  slippageBps as (typeof SLIPPAGE_PRESETS)[number],
                )
                  ? styles.chipActive
                  : "",
              ].join(" ")}
              onClick={() => {
                const raw = window.prompt(
                  "Slippage %",
                  String(slippageBps / 100),
                );
                if (raw == null) return;
                const parsed = parseSlippagePercentInput(raw);
                if (parsed == null) {
                  window.alert(SWAP_COPY.slippageInvalid);
                  return;
                }
                setSlippageBps(clampSlippageBps(parsed));
              }}
            >
              Custom
            </button>
          </div>
        </div>
      </div>

      {quote && fresh && mintAligned && impactLevel === "elevated" ? (
        <div className={styles.riskNote}>{SWAP_COPY.impactElevated}</div>
      ) : null}
      {quote && fresh && mintAligned && impactLevel === "high" ? (
        <div className={`${styles.riskNote} ${styles.riskStrong}`}>
          {SWAP_COPY.impactHigh}
        </div>
      ) : null}
      {unverifiedPair ? (
        <div className={styles.riskNote}>{SWAP_COPY.unverifiedRisk}</div>
      ) : null}

      <div
        className={[styles.status, statusWarn ? styles.statusWarn : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {statusText}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={`${buttonStyles.button} ${buttonStyles.primary} ${buttonStyles.block}`}
          disabled={primaryDisabled}
          onClick={onPrimary}
        >
          {primaryLabel}
        </button>
        {wallet ? (
          <button
            type="button"
            className={styles.secondaryAction}
            onClick={() => void disconnect()}
          >
            {shortKey(wallet.publicKey)} · Disconnect
          </button>
        ) : null}
      </div>

      <TokenSelector
        open={selectorSide !== null}
        excludeMint={
          selectorSide === "pay"
            ? receiveToken.mint
            : selectorSide === "receive"
              ? payToken.mint
              : undefined
        }
        balances={balances}
        onClose={() => setSelectorSide(null)}
        onSelect={onSelectToken}
      />

      <SwapConfirmModal
        open={confirmOpen}
        details={confirmDetails}
        executionEnabled={executionOn}
        confirming={confirming}
        statusMessage={confirmStatus}
        pendingSignature={pendingSignature}
        onCancel={() => {
          if (confirming) return;
          setConfirmOpen(false);
          setConfirmStatus(null);
          setPendingSignature(null);
        }}
        onConfirm={onConfirmSwap}
      />
    </div>
  );
}

function TokenChip({
  token,
  onClick,
}: {
  token: TokenAsset;
  onClick: () => void;
}) {
  return (
    <button type="button" className={styles.token} onClick={onClick}>
      {isAxmToken(token) || token.symbol === "AXM" ? (
        <BrandMark size={18} className={styles.tokenMark} />
      ) : token.iconUrl ? (
        <img
          src={token.iconUrl}
          alt=""
          className={styles.tokenMark}
          width={18}
          height={18}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className={styles.tokenDot} aria-hidden />
      )}
      {token.symbol}
      <span className={styles.tokenCaret} aria-hidden>
        ▾
      </span>
    </button>
  );
}
