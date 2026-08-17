import { getActiveMint, isLaunchLive } from "@/config/launch";

export const JUPITER_PLUGIN_SCRIPT = "https://plugin.jup.ag/plugin-v1.js";
export const JUPITER_MOUNT_ID = "axiom-jupiter";

const SOL_MINT = "So11111111111111111111111111111111111111112";

declare global {
  interface Window {
    Jupiter?: {
      init: (options: Record<string, unknown>) => void;
      close: () => void;
    };
  }
}

/** Plugin init config — only valid after launch mint is set. */
export function getPluginInitConfig(
  integratedTargetId = JUPITER_MOUNT_ID,
): Record<string, unknown> | null {
  if (!isLaunchLive()) return null;
  const mint = getActiveMint();
  if (!mint) return null;

  return {
    displayMode: "integrated",
    integratedTargetId,
    formProps: {
      initialInputMint: SOL_MINT,
      initialOutputMint: mint,
      fixedMint: mint,
    },
  };
}

export function initJupiterPlugin(): boolean {
  const config = getPluginInitConfig();
  if (!config || !window.Jupiter?.init) return false;
  window.Jupiter.init(config);
  return true;
}

export function closeJupiterPlugin(): void {
  window.Jupiter?.close?.();
}
