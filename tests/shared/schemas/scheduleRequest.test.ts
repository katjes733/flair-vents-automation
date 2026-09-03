import { describe, it, expect } from "vitest";
import {
  createScheduleRequestSchema,
  updateScheduleRequestSchema,
} from "~/shared/schemas/scheduleRequest";

describe("createScheduleRequestSchema", () => {
  it("defaults events to [] and config to {enabled: true, default_inactive: false}", () => {
    const result = createScheduleRequestSchema.parse({ name: "Night" });
    expect(result).toEqual({
      name: "Night",
      events: [],
      config: { enabled: true, default_inactive: false },
    });
  });

  it("rejects an empty name", () => {
    expect(() => createScheduleRequestSchema.parse({ name: "" })).toThrow();
  });

  it("rejects an event whose start_time equals its end_time", () => {
    expect(() =>
      createScheduleRequestSchema.parse({
        name: "Night",
        events: [
          {
            mode: "active",
            start_time: "20:00",
            end_time: "20:00",
            days_of_week: 1,
            zone_settings: [],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("updateScheduleRequestSchema — config", () => {
  // Regression test: a plain `scheduleConfigSchema.partial()` does NOT
  // produce a true partial — Zod still substitutes each field's own
  // `.default()` for an omitted key even once `.partial()` wraps it
  // `.optional()`. The same bug already found and fixed for
  // zoneConfigSchema/systemSettingsConfigSchema (see genuinePartial's own
  // comment) — a minimal `{config: {description: "x"}}` PATCH would
  // otherwise silently reset `enabled`/`default_inactive` back to their
  // schema defaults once merged onto the existing row in
  // scheduleService.ts's `{...existing.config, ...patch.config}`.
  it("leaves an omitted config field genuinely absent, not defaulted", () => {
    const result = updateScheduleRequestSchema.parse({
      config: { description: "x" },
    });
    expect(result.config).toEqual({ description: "x" });
  });

  it("still validates a fully-specified config the same as the full schema", () => {
    const result = updateScheduleRequestSchema.parse({
      config: { enabled: false, default_inactive: true },
    });
    expect(result.config).toEqual({ enabled: false, default_inactive: true });
  });

  it("allows omitting config entirely on a name-only patch", () => {
    const result = updateScheduleRequestSchema.parse({ name: "New name" });
    expect(result).toEqual({ name: "New name" });
  });
});
