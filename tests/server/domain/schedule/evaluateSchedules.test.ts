import { describe, it, expect } from "vitest";
import {
  resolveGoverningEvent,
  selectActiveEvents,
  type ScheduleEventCandidate,
} from "~/server/domain/schedule/evaluateSchedules";

function makeEvent(
  overrides: Partial<ScheduleEventCandidate["event"]>,
): ScheduleEventCandidate["event"] {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    created_at: "2024-01-01T00:00:00.000Z",
    modified_at: "2024-01-01T00:00:00.000Z",
    mode: "active",
    start_time: "08:00",
    end_time: "17:00",
    days_of_week: 0b1111111,
    assigned_zone_ids: [],
    ...overrides,
  };
}

describe("selectActiveEvents", () => {
  it("filters candidates down to those active right now", () => {
    const active: ScheduleEventCandidate = {
      scheduleId: "s1",
      event: makeEvent({ start_time: "00:00", end_time: "23:59" }),
    };
    const inactive: ScheduleEventCandidate = {
      scheduleId: "s2",
      event: makeEvent({ start_time: "23:58", end_time: "23:59" }),
    };
    const result = selectActiveEvents(
      [active, inactive],
      Date.UTC(2024, 0, 1, 12, 0),
      "UTC",
    );
    expect(result).toEqual([active]);
  });
});

describe("resolveGoverningEvent", () => {
  it("returns null when nothing is active", () => {
    expect(resolveGoverningEvent([])).toBeNull();
  });

  it("prefers the more specific (fewer days_of_week bits) event", () => {
    const broad: ScheduleEventCandidate = {
      scheduleId: "s1",
      event: makeEvent({ days_of_week: 0b1111111 }),
    };
    const specific: ScheduleEventCandidate = {
      scheduleId: "s2",
      event: makeEvent({ days_of_week: 0b0000010 }),
    };
    expect(resolveGoverningEvent([broad, specific])).toBe(specific);
  });

  it("breaks a specificity tie by the most recently edited event", () => {
    const older: ScheduleEventCandidate = {
      scheduleId: "s1",
      event: makeEvent({
        days_of_week: 0b0000001,
        modified_at: "2024-01-01T00:00:00.000Z",
      }),
    };
    const newer: ScheduleEventCandidate = {
      scheduleId: "s2",
      event: makeEvent({
        days_of_week: 0b0000001,
        modified_at: "2024-06-01T00:00:00.000Z",
      }),
    };
    expect(resolveGoverningEvent([older, newer])).toBe(newer);
  });
});
