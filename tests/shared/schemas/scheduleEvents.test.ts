import { describe, it, expect } from "vitest";
import {
  resolveScheduleEvents,
  resolveScheduleConfig,
  scheduleEventSchema,
} from "~/shared/schemas/scheduleEvents";

const baseEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-01-01T00:00:00.000Z",
  modified_at: "2026-01-01T00:00:00.000Z",
  mode: "active" as const,
  start_time: "08:00",
  end_time: "17:00",
  days_of_week: 0b0111110,
  assigned_zone_ids: [],
};

describe("scheduleEventSchema", () => {
  it("accepts a well-formed active event", () => {
    expect(() => scheduleEventSchema.parse(baseEvent)).not.toThrow();
  });

  it("rejects start_time === end_time as ambiguous", () => {
    expect(() =>
      scheduleEventSchema.parse({
        ...baseEvent,
        start_time: "08:00",
        end_time: "08:00",
      }),
    ).toThrow();
  });

  it("rejects a malformed time-of-day string", () => {
    expect(() =>
      scheduleEventSchema.parse({ ...baseEvent, start_time: "8:00am" }),
    ).toThrow();
  });

  it("accepts an overnight wraparound window", () => {
    expect(() =>
      scheduleEventSchema.parse({
        ...baseEvent,
        start_time: "20:30",
        end_time: "07:00",
      }),
    ).not.toThrow();
  });
});

describe("resolveScheduleEvents / resolveScheduleConfig", () => {
  it("defaults events to an empty array", () => {
    expect(resolveScheduleEvents(undefined)).toEqual([]);
  });

  it("defaults config with enabled true and default_inactive false", () => {
    const config = resolveScheduleConfig({});
    expect(config.enabled).toBe(true);
    expect(config.default_inactive).toBe(false);
  });
});
