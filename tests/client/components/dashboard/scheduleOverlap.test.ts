import { describe, it, expect } from "vitest";
import { findOverlappingEvents } from "~/client/components/dashboard/scheduleOverlap";
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

describe("findOverlappingEvents", () => {
  it("flags a same-day, overlapping-time event that shares a room", () => {
    const other = makeEvent({
      id: "other",
      start_time: "12:00",
      end_time: "20:00",
      days_of_week: 0b0000001, // Sun
      zone_settings: [{ zone_id: "z1", assume_occupied: false }],
    });
    const matches = findOverlappingEvents(
      {
        start_time: "08:00",
        end_time: "17:00",
        days_of_week: 0b0000001,
        zoneIds: ["z1"],
      },
      [other],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].event.id).toBe("other");
    expect(matches[0].sharedZoneIds).toEqual(["z1"]);
    expect(matches[0].overlappingDays).toEqual([0]);
  });

  it("does not flag events on different days", () => {
    const other = makeEvent({
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: 0b0000010, // Mon
      zone_settings: [{ zone_id: "z1", assume_occupied: false }],
    });
    const matches = findOverlappingEvents(
      {
        start_time: "08:00",
        end_time: "17:00",
        days_of_week: 0b0000001, // Sun
        zoneIds: ["z1"],
      },
      [other],
    );
    expect(matches).toHaveLength(0);
  });

  it("does not flag same-day overlapping events with no shared room", () => {
    const other = makeEvent({
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: 0b0000001,
      zone_settings: [{ zone_id: "z2", assume_occupied: false }],
    });
    const matches = findOverlappingEvents(
      {
        start_time: "08:00",
        end_time: "17:00",
        days_of_week: 0b0000001,
        zoneIds: ["z1"],
      },
      [other],
    );
    expect(matches).toHaveLength(0);
  });

  it("does not flag same-day, same-room events whose time windows don't touch", () => {
    const other = makeEvent({
      start_time: "18:00",
      end_time: "20:00",
      days_of_week: 0b0000001,
      zone_settings: [{ zone_id: "z1", assume_occupied: false }],
    });
    const matches = findOverlappingEvents(
      {
        start_time: "08:00",
        end_time: "17:00",
        days_of_week: 0b0000001,
        zoneIds: ["z1"],
      },
      [other],
    );
    expect(matches).toHaveLength(0);
  });

  it("detects an overlap created by a wraparound window's next-day tail", () => {
    const other = makeEvent({
      start_time: "06:00",
      end_time: "09:00",
      days_of_week: 0b0000010, // Mon
      zone_settings: [{ zone_id: "z1", assume_occupied: false }],
    });
    const matches = findOverlappingEvents(
      {
        start_time: "20:00",
        end_time: "07:00", // Sunday night -> Monday morning tail
        days_of_week: 0b0000001, // Sun
        zoneIds: ["z1"],
      },
      [other],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].overlappingDays).toEqual([1]); // Monday
  });

  it("reports only the rooms actually shared, not every candidate room", () => {
    const other = makeEvent({
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: 0b0000001,
      zone_settings: [
        { zone_id: "z2", assume_occupied: false },
        { zone_id: "z3", assume_occupied: false },
      ],
    });
    const matches = findOverlappingEvents(
      {
        start_time: "08:00",
        end_time: "17:00",
        days_of_week: 0b0000001,
        zoneIds: ["z1", "z2", "z3"],
      },
      [other],
    );
    expect(matches[0].sharedZoneIds.sort()).toEqual(["z2", "z3"]);
  });

  it("checks every other event independently, returning one match per conflicting event", () => {
    const a = makeEvent({
      id: "a",
      days_of_week: 0b0000001,
      zone_settings: [{ zone_id: "z1", assume_occupied: false }],
    });
    const b = makeEvent({
      id: "b",
      days_of_week: 0b0000001,
      zone_settings: [{ zone_id: "z1", assume_occupied: false }],
    });
    const c = makeEvent({
      id: "c",
      days_of_week: 0b0000010, // no day overlap at all
      zone_settings: [{ zone_id: "z1", assume_occupied: false }],
    });
    const matches = findOverlappingEvents(
      {
        start_time: "08:00",
        end_time: "17:00",
        days_of_week: 0b0000001,
        zoneIds: ["z1"],
      },
      [a, b, c],
    );
    expect(matches.map((m) => m.event.id).sort()).toEqual(["a", "b"]);
  });
});
