# Axiom — V2 (Pre-launch)

Production brand site for **Axiom** at `https://axiom-swap.xyz`.

**Current state:** pre-launch. No live token mint is configured.

## Activate after Pump.fun launch

Edit one file: [`src/config/launch.ts`](src/config/launch.ts)

```ts
export const LAUNCH = {
  status: "live",
  isLive: true,
  mint: "<paste-real-pump-fun-mint>",
  decimals: null, // optional; otherwise fetched on-chain
  pumpFunUrl: "https://pump.fun/coin/<mint>", // optional
  platform: "Pump.fun",
  targetLaunchAt: null,
};
```

When `isLive === true` and `mint` is set:

- Launch panel shows mint + Pump.fun / explorer links
- AXM becomes eligible in token discovery (when metadata/route exist)
- Market / on-chain AXM hooks become eligible to fetch

The general Axiom Swap terminal (SOL ↔ USDC and other supported tokens) is configured in [`src/config/swap.ts`](src/config/swap.ts) and does **not** require AXM to be live. Quotes and execution are enabled for controlled mainnet use (wallet Confirm + approval still required).

Do **not** invent a mint address. Do **not** reuse any abandoned legacy mint.
The previous AXM token implementation is abandoned; only the new Pump.fun mint belongs here.

Swap routing uses an Axiom UI over a provider-abstracted service layer (Jupiter HTTP APIs behind the scenes). No embedded third-party swap iframe.

## Scripts

```bash
npm install
npm run dev
npm run typecheck
npm run lint
npm run build
```

## Stack

Vite + React 19 + TypeScript · TanStack Query · GitHub Pages (`public/CNAME`)
