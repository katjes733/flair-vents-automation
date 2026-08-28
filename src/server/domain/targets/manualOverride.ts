import type {
  ManualOverrideConfig,
  HoldType,
} from "~/shared/schemas/manualOverride";
import { isEventActiveAt } from "~/server/domain/schedule/timeWindow";

export interface StoredManualOverride {
  config: ManualOverrideConfig;
  expiresAtMs: number | null; // null = permanent
  revokedAtMs: number | null;
}

/**
 * The currently-active override, if any. "Currently active" selection
 * (most recent, not-expired, not-revoked row per zone) is a DB concern —
 * this only decides whether an already-selected row is still in effect
 * right now. See "manual_overrides ... append-only" in the Data Model.
 */
export function resolveManualOverride(
  override: StoredManualOverride | null,
  nowMs: number,
): ManualOverrideConfig | null {
  if (!override) return null;
  if (override.revokedAtMs !== null) return null;
  if (override.expiresAtMs !== null && override.expiresAtMs <= nowMs)
    return null;
  return override.config;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/** Computes a hold's expiry per its hold_type. */
export function computeOverrideExpiry(
  holdType: HoldType,
  nowMs: number,
  nextEventBoundaryMs: number | null,
): number | null {
  switch (holdType) {
    case "2h":
      return nowMs + TWO_HOURS_MS;
    case "4h":
      return nowMs + FOUR_HOURS_MS;
    case "permanent":
      return null;
    case "until_next_event":
      return nextEventBoundaryMs;
  }
}

/**
 * "until next event"'s forward scan, across midnight and any DST boundary
 * — the spec states this hold option but doesn't spell out the scan logic
 * itself. Walks forward in fixed steps (reusing the same DST-aware
 * `isEventActiveAt` every schedule evaluation already uses) until any
 * candidate event's active/inactive state changes, bounded by a horizon so
 * a zone with no events at all doesn't scan forever.
 */
export function findNextEventBoundary(
  events: Array<{ start_time: string; end_time: string; days_of_week: number }>,
  nowMs: number,
  timezone: string,
  horizonMs: number = 8 * 24 * 60 * 60 * 1000,
  stepMs: number = 60 * 1000,
): number | null {
  const wasActive = events.map((e) => isEventActiveAt(e, nowMs, timezone));
  for (let t = nowMs + stepMs; t <= nowMs + horizonMs; t += stepMs) {
    const isActive = events.map((e) => isEventActiveAt(e, t, timezone));
    if (isActive.some((active, i) => active !== wasActive[i])) {
      return t;
    }
  }
  return null;
}
