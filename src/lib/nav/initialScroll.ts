/**
 * Root "/" should land on the hero. Explicit hashes (e.g. #trade) keep
 * normal anchor behavior. Never invent a #trade hash on startup.
 */
export function applyInitialScroll(): void {
  if (typeof window === "undefined") return;

  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }

  const hash = window.location.hash;
  const hasExplicitHash =
    Boolean(hash) && hash !== "#" && hash !== "#top";

  if (!hasExplicitHash) {
    window.scrollTo(0, 0);
    return;
  }

  const id = decodeURIComponent(hash.slice(1));
  if (!id) {
    window.scrollTo(0, 0);
    return;
  }

  const scrollToHash = () => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "auto", block: "start" });
    }
  };

  // Wait a frame so section layout exists after React mount.
  requestAnimationFrame(() => {
    requestAnimationFrame(scrollToHash);
  });
}

export function scrollToTradeSection(): void {
  const el = document.getElementById("trade");
  if (!el) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });

  if (window.location.hash !== "#trade") {
    window.history.pushState(null, "", "#trade");
  }
}
