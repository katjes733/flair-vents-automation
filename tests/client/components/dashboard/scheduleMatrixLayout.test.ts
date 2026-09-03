import { describe, it, expect } from "vitest";
import {
  bitCount,
  eventBeats,
  computeDaySegments,
  resolveDayOverlaps,
  MINUTES_PER_DAY,
} from "~/client/components/dashboard/scheduleMatrixLayout";
import type { ScheduleEvent } from "~/client/api/schedulesApi";

function makeEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "ev-1",
    created_at: "2024-01-01T00:00:00.000Z",
    modified_at: "2024-01-01T00:00:00.000Z",
    mode: "active",
    start_time: "08:00",
    end_time: "17:00",
    days_of_week: 0b1111111,
    zone_settings: [],
    ...overrides,
  };
}

describe("bitCount", () => {
  it("counts set bits", () => {
    expect(bitCount(0)).toBe(0);
    expect(bitCount(0b1111111)).toBe(7);
    expect(bitCount(0b0100010)).toBe(2);
  });
});

describe("eventBeats", () => {
  it("a more specific (fewer days) event beats a broader one", () => {
    const specific = makeEvent({ id: "a", days_of_week: 0b0000010 }); // 1 day
    const broad = makeEvent({ id: "b", days_of_week: 0b1111111 }); // 7 days
    expect(eventBeats(specific, broad)).toBe(true);
    expect(eventBeats(broad, specific)).toBe(false);
  });

  it("with equal specificity, the more recently edited event wins", () => {
    const older = makeEvent({
      id: "a",
      days_of_week: 0b0000011,
      modified_at: "2024-01-01T00:00:00.000Z",
    });
    const newer = makeEvent({
      id: "b",
      days_of_week: 0b0000011,
      modified_at: "2024-06-01T00:00:00.000Z",
    });
    expect(eventBeats(newer, older)).toBe(true);
    expect(eventBeats(older, newer)).toBe(false);
  });
});

describe("computeDaySegments", () => {
  it("produces one segment per assigned day for a same-day window", () => {
    const event = makeEvent({
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: 0b0000110,
    }); // Mon, Tue
    const segments = computeDaySegments([event]);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.day).sort()).toEqual([1, 2]);
    expect(segments[0].startMinutes).toBe(8 * 60);
    expect(segments[0].endMinutes).toBe(17 * 60);
    expect(segments[0].isWraparoundTail).toBe(false);
  });

  it("splits a wraparound window into an evening segment and a next-day tail", () => {
    const event = makeEvent({
      start_time: "20:30",
      end_time: "07:00",
      days_of_week: 0b0000001,
    }); // Sunday
    const segments = computeDaySegments([event]);
    expect(segments).toHaveLength(2);
    const evening = segments.find((s) => !s.isWraparoundTail)!;
    const tail = segments.find((s) => s.isWraparoundTail)!;
    expect(evening.day).toBe(0); // Sunday
    expect(evening.startMinutes).toBe(20 * 60 + 30);
    expect(evening.endMinutes).toBe(MINUTES_PER_DAY);
    expect(tail.day).toBe(1); // Monday
    expect(tail.startMinutes).toBe(0);
    expect(tail.endMinutes).toBe(7 * 60);
  });

  it("skips a zero-length tail when end_time is exactly 00:00", () => {
    // end === 0 minutes means the event ends exactly at the day boundary
    // — no actual next-day minutes are covered, matching isEventActiveAt's
    // own wraparound rule server-side ("minutesOfDay < end" is never true
    // when end is 0).
    const event = makeEvent({
      start_time: "20:00",
      end_time: "00:00",
      days_of_week: 0b0000001,
    });
    const segments = computeDaySegments([event]);
    expect(segments).toHaveLength(1);
    expect(segments[0].isWraparoundTail).toBe(false);
    expect(segments[0].endMinutes).toBe(MINUTES_PER_DAY);
  });

  it("wraps Saturday's tail around to Sunday (day index 6 -> 0)", () => {
    const event = makeEvent({
      start_time: "22:00",
      end_time: "06:00",
      days_of_week: 0b1000000,
    }); // Saturday
    const segments = computeDaySegments([event]);
    const tail = segments.find((s) => s.isWraparoundTail)!;
    expect(tail.day).toBe(0);
  });
});

describe("resolveDayOverlaps", () => {
  it("a segment with no overlap is entirely solid", () => {
    const event = makeEvent();
    const segments = computeDaySegments([event]).filter((s) => s.day === 0);
    const [rendered] = resolveDayOverlaps(segments);
    expect(rendered.hatchedRanges).toEqual([]);
    expect(rendered.solidRanges).toEqual([{ start: 8 * 60, end: 17 * 60 }]);
  });

  it("a fully-dominated segment is entirely hatched", () => {
    const broad = makeEvent({
      id: "broad",
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: 0b1111111,
    });
    const specific = makeEvent({
      id: "specific",
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: 0b0000001,
    });
    const segments = computeDaySegments([broad, specific]).filter(
      (s) => s.day === 0,
    );
    const rendered = resolveDayOverlaps(segments);
    const broadRendered = rendered.find((r) => r.segment.event.id === "broad")!;
    const specificRendered = rendered.find(
      (r) => r.segment.event.id === "specific",
    )!;
    // The specific event wins (fewer bits) -> broad's overlapping range is hatched.
    expect(broadRendered.hatchedRanges).toEqual([
      { start: 8 * 60, end: 17 * 60 },
    ]);
    expect(broadRendered.solidRanges).toEqual([]);
    // The winner is entirely solid.
    expect(specificRendered.hatchedRanges).toEqual([]);
    expect(specificRendered.solidRanges).toEqual([
      { start: 8 * 60, end: 17 * 60 },
    ]);
  });

  it("a partial overlap splits the loser into solid + hatched sub-ranges", () => {
    const broad = makeEvent({
      id: "broad",
      start_time: "06:00",
      end_time: "12:00",
      days_of_week: 0b1111111,
    });
    const specific = makeEvent({
      id: "specific",
      start_time: "09:00",
      end_time: "15:00",
      days_of_week: 0b0000001,
    });
    const segments = computeDaySegments([broad, specific]).filter(
      (s) => s.day === 0,
    );
    const rendered = resolveDayOverlaps(segments);
    const broadRendered = rendered.find((r) => r.segment.event.id === "broad")!;
    // broad runs 06:00-12:00, specific (winner) runs 09:00-15:00 -> overlap is 09:00-12:00.
    expect(broadRendered.solidRanges).toEqual([{ start: 6 * 60, end: 9 * 60 }]);
    expect(broadRendered.hatchedRanges).toEqual([
      { start: 9 * 60, end: 12 * 60 },
    ]);
  });

  it("two non-overlapping events on the same day are both fully solid", () => {
    const morning = makeEvent({
      id: "morning",
      start_time: "06:00",
      end_time: "08:00",
    });
    const evening = makeEvent({
      id: "evening",
      start_time: "18:00",
      end_time: "20:00",
    });
    const segments = computeDaySegments([morning, evening]).filter(
      (s) => s.day === 0,
    );
    const rendered = resolveDayOverlaps(segments);
    for (const r of rendered) {
      expect(r.hatchedRanges).toEqual([]);
      expect(r.solidRanges).toHaveLength(1);
    }
  });
});
