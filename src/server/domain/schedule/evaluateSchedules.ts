import type { ScheduleEvent } from "~/shared/schemas/scheduleEvents";
import { isEventActiveAt } from "~/server/domain/schedule/timeWindow";
import { bitCount } from "~/server/domain/schedule/dayMask";

export interface ScheduleEventCandidate {
  scheduleId: string;
  event: ScheduleEvent;
}

/** Every candidate event (across every schedule this zone belongs to) active right now. */
export function selectActiveEvents(
  candidates: ScheduleEventCandidate[],
  nowMs: number,
  timezone: string,
): ScheduleEventCandidate[] {
  return candidates.filter((c) => isEventActiveAt(c.event, nowMs, timezone));
}

/**
 * Resolves the single governing event among overlapping active events.
 * Tiebreak: fewer days_of_week bits (more specific) wins; if tied, the
 * most recently edited *event* wins (per-event modified_at, not the
 * schedule row's modified_time) — see "Scheduling Engine".
 */
export function resolveGoverningEvent(
  active: ScheduleEventCandidate[],
): ScheduleEventCandidate | null {
  if (active.length === 0) return null;
  return active.reduce((best, candidate) => {
    const bestBits = bitCount(best.event.days_of_week);
    const candidateBits = bitCount(candidate.event.days_of_week);
    if (candidateBits < bestBits) return candidate;
    if (candidateBits > bestBits) return best;
    return candidate.event.modified_at > best.event.modified_at
      ? candidate
      : best;
  });
}
