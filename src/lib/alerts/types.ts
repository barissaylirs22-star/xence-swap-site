import type { RiskLevel } from "@/lib/intelligence/types";

/** Exact Alerts V1 types — no others. */
export type AlertType =
  | "RISK_BECAME_HIGH"
  | "CONCENTRATION_RISING"
  | "STRUCTURE_BUILDING"
  | "LARGE_HOLDER_DISTRIBUTION"
  | "LIQUIDITY_DROP";

export type AlertPriority = "CRITICAL" | "IMPORTANT" | "INFORMATIONAL";

export interface FollowedToken {
  mint: string;
  symbol?: string;
  name?: string;
  createdAt: number;
}

export interface AlertEvent {
  id: string;
  mint: string;
  symbol?: string;
  name?: string;
  type: AlertType;
  priority: AlertPriority;
  reason: string;
  createdAt: number;
  read: boolean;
}

/**
 * Persisted arm / baseline state per mint + alert type.
 * First observation sets baselined; transitions fire; clear re-arms.
 */
export interface AlertArmState {
  baselined: boolean;
  /** Condition currently active (binary alerts) or risk === HIGH. */
  active: boolean;
  lastFiredAt: number | null;
  /** RISK_BECAME_HIGH: last known non-UNKNOWN level. */
  lastRiskLevel?: RiskLevel | null;
}

export type AlertArmMap = Record<string, AlertArmState>;

export const ALERT_MAX_EVENTS = 50;
export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const ALERT_PRIORITY: Record<AlertType, AlertPriority> = {
  RISK_BECAME_HIGH: "CRITICAL",
  CONCENTRATION_RISING: "IMPORTANT",
  STRUCTURE_BUILDING: "INFORMATIONAL",
  LARGE_HOLDER_DISTRIBUTION: "IMPORTANT",
  LIQUIDITY_DROP: "IMPORTANT",
};

export function alertArmKey(mint: string, type: AlertType): string {
  return `${mint}:${type}`;
}
