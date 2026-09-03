import type { ScheduleEvent } from "~/client/api/schedulesApi";

// Pure overlap-detection logic, split into its own non-component module —
// same "pure logic extraction" convention as scheduleMatrixLayout.ts and
// reorderDragLogic.ts. Deliberately independent of computeDaySegments
// (scheduleMatrixLayout.ts) rather than reusing it directly: this needs to
// check a not-yet-saved *draft* (no id/timestamps yet) against real events,
// so it operates on a minimal time-window shape instead of a full
// ScheduleEvent.

const MINUTES_PER_DAY = 24 * 60;

interface TimeWindow {
  start_time: string;
  end_time: string;
  days_of_week: number;
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Same wraparound splitting rule as computeDaySegments: an overnight window
 * contributes an evening segment on the day it starts and a tail segment on
 * the following day, with a zero-length tail (end_time exactly "00:00")
 * correctly omitted.
 */
function windowDaySegments(
  w: TimeWindow,
): Array<{ day: number; start: number; end: number }> {
  const start = timeToMinutes(w.start_time);
  const end = timeToMinutes(w.end_time);
  const wraps = start >= end;
  const segments: Array<{ day: number; start: number; end: number }> = [];
  for (let day = 0; day < 7; day++) {
    if (((w.days_of_week >> day) & 1) === 0) continue;
    if (!wraps) {
      segments.push({ day, start, end });
    } else {
      segments.push({ day, start, end: MINUTES_PER_DAY });
      if (end > 0) segments.push({ day: (day + 1) % 7, start: 0, end });
    }
  }
  return segments;
}

/** Every day (0=Sun..6=Sat) on which `a` and `b`'s time windows actually intersect. */
function overlappingDays(a: TimeWindow, b: TimeWindow): number[] {
  const segmentsA = windowDaySegments(a);
  const segmentsB = windowDaySegments(b);
  const days = new Set<number>();
  for (const sa of segmentsA) {
    for (const sb of segmentsB) {
      if (sa.day === sb.day && sa.start < sb.end && sb.start < sa.end) {
        days.add(sa.day);
      }
    }
  }
  return [...days].sort((a, b) => a - b);
}

export interface OverlapMatch {
  event: ScheduleEvent;
  sharedZoneIds: string[];
  overlappingDays: number[];
}

/**
 * Every existing event that genuinely conflicts with a candidate draft — same
 * day, overlapping time window, *and* at least one room in common. Sharing a
 * day/time with an event that has no rooms in common isn't a real conflict
 * (nothing actually competes), so it's excluded.
 */
export function findOverlappingEvents(
  candidate: TimeWindow & { zoneIds: string[] },
  others: ScheduleEvent[],
): OverlapMatch[] {
  const results: OverlapMatch[] = [];
  for (const other of others) {
    const days = overlappingDays(candidate, other);
    if (days.length === 0) continue;
    const otherZoneIds = new Set(other.zone_settings.map((r) => r.zone_id));
    const sharedZoneIds = candidate.zoneIds.filter((id) =>
      otherZoneIds.has(id),
    );
    if (sharedZoneIds.length > 0) {
      results.push({ event: other, sharedZoneIds, overlappingDays: days });
    }
  }
  return results;
}
