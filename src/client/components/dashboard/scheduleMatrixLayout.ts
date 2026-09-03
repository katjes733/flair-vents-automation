// Pure schedule-matrix layout/overlap math, split into its own
// non-component module — a component file exporting anything besides
// components breaks React Fast Refresh (react-refresh/only-export-
// components). Also makes this directly unit-testable with plain numbers,
// which matters here specifically: overlap-tiebreak-and-clip is genuinely
// combinatorial (which segments overlap, which one wins, which sub-ranges
// of the loser are actually covered) and easy to get subtly wrong.
import type { ScheduleEvent } from "~/client/api/schedulesApi";

export const MINUTES_PER_DAY = 24 * 60;

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Popcount — bit 0 = Sunday ... bit 6 = Saturday, per days_of_week's own convention. */
export function bitCount(mask: number): number {
  let count = 0;
  let n = mask;
  while (n > 0) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}

/**
 * Mirrors the server's own resolveGoverningEvent tiebreak exactly (see
 * src/server/domain/schedule/evaluateSchedules.ts): fewer days_of_week
 * bits is more specific and wins; if tied, the more recently edited event
 * (by its own modified_at, not the schedule row's) wins. Kept as a small,
 * independently-reasoned duplicate here rather than importing server code
 * into the client bundle — client code never imports from ~/server/*.
 */
export function eventBeats(a: ScheduleEvent, b: ScheduleEvent): boolean {
  const aBits = bitCount(a.days_of_week);
  const bBits = bitCount(b.days_of_week);
  if (aBits !== bBits) return aBits < bBits;
  return a.modified_at > b.modified_at;
}

export interface DaySegment {
  event: ScheduleEvent;
  day: number; // 0 = Sunday ... 6 = Saturday
  startMinutes: number;
  endMinutes: number; // always > startMinutes, both within [0, MINUTES_PER_DAY]
  /** True for the early-morning tail of a wraparound event, in the *next* day's column. */
  isWraparoundTail: boolean;
}

/**
 * One or two segments per (event, day) it covers — an overnight window
 * (start >= end) contributes an evening segment in the day it starts and
 * an early-morning tail segment in the following day's column, matching
 * isEventActiveAt's own wraparound rule.
 */
export function computeDaySegments(events: ScheduleEvent[]): DaySegment[] {
  const segments: DaySegment[] = [];
  for (const event of events) {
    const start = timeToMinutes(event.start_time);
    const end = timeToMinutes(event.end_time);
    const wraps = start >= end;
    for (let day = 0; day < 7; day++) {
      if (((event.days_of_week >> day) & 1) === 0) continue;
      if (!wraps) {
        segments.push({
          event,
          day,
          startMinutes: start,
          endMinutes: end,
          isWraparoundTail: false,
        });
      } else {
        segments.push({
          event,
          day,
          startMinutes: start,
          endMinutes: MINUTES_PER_DAY,
          isWraparoundTail: false,
        });
        // end_time === "00:00" (end === 0) makes the tail zero-length —
        // the event simply ends exactly at the day boundary, no actual
        // next-day minutes are covered. Matches isEventActiveAt's own
        // wraparound rule server-side ("minutesOfDay < end" is never true
        // when end is 0), so this isn't a client-side-only special case.
        if (end > 0) {
          segments.push({
            event,
            day: (day + 1) % 7,
            startMinutes: 0,
            endMinutes: end,
            isWraparoundTail: true,
          });
        }
      }
    }
  }
  return segments;
}

export interface Interval {
  start: number;
  end: number;
}

function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

/** The parts of `base` not covered by any interval in the already-arbitrary-order `subtract` list. */
function subtractIntervals(base: Interval, subtract: Interval[]): Interval[] {
  let remaining: Interval[] = [base];
  for (const sub of mergeIntervals(subtract)) {
    const next: Interval[] = [];
    for (const r of remaining) {
      const iv = intersect(r, sub);
      if (!iv) {
        next.push(r);
        continue;
      }
      if (r.start < iv.start) next.push({ start: r.start, end: iv.start });
      if (iv.end < r.end) next.push({ start: iv.end, end: r.end });
    }
    remaining = next;
  }
  return remaining;
}

export interface RenderedSegment {
  segment: DaySegment;
  solidRanges: Interval[];
  hatchedRanges: Interval[];
}

/**
 * For every segment on a given day, splits its time range into the parts
 * genuinely uncontested (solid) vs. the parts where a *stronger* segment
 * (per eventBeats) also covers that same moment (hatched) — so an
 * overlap's resolution is visible on the matrix itself, not a silent
 * surprise. A segment that never loses any part of itself gets one solid
 * range and no hatched ones.
 */
function toInterval(segment: DaySegment): Interval {
  return { start: segment.startMinutes, end: segment.endMinutes };
}

export function resolveDayOverlaps(
  daySegments: DaySegment[],
): RenderedSegment[] {
  return daySegments.map((segment) => {
    const own = toInterval(segment);
    const dominating = daySegments
      .filter(
        (other) => other !== segment && eventBeats(other.event, segment.event),
      )
      .map((other) => intersect(own, toInterval(other)))
      .filter((iv): iv is Interval => iv !== null);
    const hatchedRanges = mergeIntervals(dominating);
    const solidRanges = subtractIntervals(own, hatchedRanges);
    return { segment, solidRanges, hatchedRanges };
  });
}
