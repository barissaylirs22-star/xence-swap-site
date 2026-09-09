/**
 * Ignore stale in-flight portfolio reads after wallet change / refresh.
 * Abort previous work; do not poll.
 */
export function createPortfolioLoadGate() {
  let generation = 0;
  let controller: AbortController | null = null;

  return {
    start(owner: string | null) {
      generation += 1;
      controller?.abort();
      controller = typeof AbortController === "function"
        ? new AbortController()
        : null;
      const current = generation;
      return {
        generation: current,
        owner,
        signal: controller?.signal,
        isCurrent: () => current === generation,
      };
    },
    abort() {
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };
}
