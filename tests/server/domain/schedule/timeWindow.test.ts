import { describe, it, expect } from "vitest";
import { isEventActiveAt } from "~/server/domain/schedule/timeWindow";
import { dayBit } from "~/server/domain/schedule/dayMask";

const SUNDAY = dayBit(0);
const MONDAY = dayBit(1);

describe("isEventActiveAt — same-day windows", () => {
  it("is active within the window on a matching day, inactive outside it", () => {
    const event = {
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: MONDAY,
    };
    // Monday 2024-01-01 12:00 America/Denver = 19:00 UTC.
    const withinWindow = Date.UTC(2024, 0, 1, 19, 0);
    const beforeWindow = Date.UTC(2024, 0, 1, 14, 0); // 07:00 local
    expect(isEventActiveAt(event, withinWindow, "America/Denver")).toBe(true);
    expect(isEventActiveAt(event, beforeWindow, "America/Denver")).toBe(false);
  });

  it("is inactive on a non-matching day even within the time window", () => {
    const event = {
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: MONDAY,
    };
    // Sunday 2023-12-31 12:00 America/Denver = 19:00 UTC.
    const sundaySameTime = Date.UTC(2023, 11, 31, 19, 0);
    expect(isEventActiveAt(event, sundaySameTime, "America/Denver")).toBe(
      false,
    );
  });
});

describe("isEventActiveAt — wraparound windows", () => {
  const event = {
    start_time: "20:30",
    end_time: "07:00",
    days_of_week: SUNDAY,
  };

  it("is active from start to midnight on the start day", () => {
    // Sunday 2024-01-07 21:00 America/Denver = 04:00 UTC Jan 8.
    const lateSunday = Date.UTC(2024, 0, 8, 4, 0);
    expect(isEventActiveAt(event, lateSunday, "America/Denver")).toBe(true);
  });

  it("is active from midnight to end on the day after", () => {
    // Monday 2024-01-08 05:00 America/Denver = 12:00 UTC.
    const earlyMonday = Date.UTC(2024, 0, 8, 12, 0);
    expect(isEventActiveAt(event, earlyMonday, "America/Denver")).toBe(true);
  });

  it("is inactive outside the wraparound window", () => {
    // Monday 2024-01-08 10:00 America/Denver = 17:00 UTC.
    const midMonday = Date.UTC(2024, 0, 8, 17, 0);
    expect(isEventActiveAt(event, midMonday, "America/Denver")).toBe(false);
  });
});

describe("isEventActiveAt — DST transitions in a DST-observing zone", () => {
  // America/Phoenix doesn't observe DST, so DST cases pin America/Denver
  // regardless of the app's actual configured home timezone.
  it("spring-forward (2024-03-10, America/Denver): stays active across the skipped hour", () => {
    const event = {
      start_time: "01:00",
      end_time: "04:00",
      days_of_week: SUNDAY,
    };
    // 01:30 MST (UTC-7) = 08:30 UTC, before the jump.
    const beforeJump = Date.UTC(2024, 2, 10, 8, 30);
    // 03:30 MDT (UTC-6) = 09:30 UTC, after the jump (02:00-03:00 skipped).
    const afterJump = Date.UTC(2024, 2, 10, 9, 30);
    expect(isEventActiveAt(event, beforeJump, "America/Denver")).toBe(true);
    expect(isEventActiveAt(event, afterJump, "America/Denver")).toBe(true);
  });

  it("fall-back (2024-11-03, America/Denver): active during both passes of the repeated hour", () => {
    const event = {
      start_time: "01:00",
      end_time: "02:00",
      days_of_week: SUNDAY,
    };
    // 01:15 MDT (UTC-6) = 07:15 UTC, first pass.
    const firstPass = Date.UTC(2024, 10, 3, 7, 15);
    // 01:15 MST (UTC-7) = 08:15 UTC, second pass (same wall clock, repeated).
    const secondPass = Date.UTC(2024, 10, 3, 8, 15);
    expect(isEventActiveAt(event, firstPass, "America/Denver")).toBe(true);
    expect(isEventActiveAt(event, secondPass, "America/Denver")).toBe(true);
  });
});
