import { describe, it, expect } from "vitest";
import {
  resolveScheduleEvents,
  resolveScheduleConfig,
  scheduleEventSchema,
} from "~/shared/schemas/scheduleEvents";

const ZONE_ID = "22222222-2222-4222-8222-222222222222";

const baseEvent = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-01-01T00:00:00.000Z",
  modified_at: "2026-01-01T00:00:00.000Z",
  mode: "active" as const,
  start_time: "08:00",
  end_time: "17:00",
  days_of_week: 0b0111110,
  zone_settings: [],
};

describe("scheduleEventSchema", () => {
  it("accepts a well-formed active event", () => {
    expect(() => scheduleEventSchema.parse(baseEvent)).not.toThrow();
  });

  it("accepts per-zone settings — different setpoint, tolerance, and sleep mode per room", () => {
    const parsed = scheduleEventSchema.parse({
      ...baseEvent,
      zone_settings: [
        {
          zone_id: ZONE_ID,
          cool_setpoint: 24,
          heat_setpoint: 18,
          comfort_tolerance: 0.5,
          assume_occupied: true,
        },
      ],
    });
    expect(parsed.zone_settings[0]).toMatchObject({
      zone_id: ZONE_ID,
      cool_setpoint: 24,
      heat_setpoint: 18,
      comfort_tolerance: 0.5,
      assume_occupied: true,
    });
  });

  it("defaults assume_occupied to false and leaves comfort_tolerance unset (tight)", () => {
    const parsed = scheduleEventSchema.parse({
      ...baseEvent,
      zone_settings: [{ zone_id: ZONE_ID }],
    });
    expect(parsed.zone_settings[0].assume_occupied).toBe(false);
    expect(parsed.zone_settings[0].comfort_tolerance).toBeUndefined();
  });

  it("rejects a comfort_tolerance beyond the sanity bound", () => {
    expect(() =>
      scheduleEventSchema.parse({
        ...baseEvent,
        zone_settings: [{ zone_id: ZONE_ID, comfort_tolerance: 100 }],
      }),
    ).toThrow();
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
