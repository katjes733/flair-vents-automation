import { z } from "zod";

// Bit 0 = Sunday ... bit 6 = Saturday. Wraparound windows (e.g. 20:30–07:00)
// use the day the window *starts*, per the Scheduling Engine section.
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

// Each event carries its own id/created_at/modified_at — additive to the
// spec's described shape, per the implementation plan's Data Model section:
// the overlap tiebreak is "the more recently edited *event* wins," which
// only works if recency is tracked per event, not per schedule row.
export const scheduleEventSchema = z
  .object({
    id: z.string().uuid(),
    created_at: z.string().datetime(),
    modified_at: z.string().datetime(),
    mode: z.enum(["active", "inactive"]),
    start_time: z.string().regex(TIME_OF_DAY, "expected HH:MM"),
    end_time: z.string().regex(TIME_OF_DAY, "expected HH:MM"),
    days_of_week: z.number().int().min(0).max(0b1111111),
    assigned_zone_ids: z.array(z.string().uuid()).default([]),
    // One setpoint pair per event, applied uniformly to every assigned zone
    // — required for "active" events, meaningless for "inactive" ones
    // (enforced in validateConfig, not expressible cleanly here).
    cool_setpoint: z.number().optional(),
    heat_setpoint: z.number().optional(),
    // "Advanced" overrides, scoped to this event/time-window only.
    zone_priority_order: z.array(z.string().uuid()).optional(),
    comfort_tolerance_overrides: z
      .record(z.string().uuid(), z.number())
      .optional(),
    driving_zone_overrides: z
      .record(z.string().uuid(), z.string().uuid())
      .optional(),
  })
  .refine((event) => event.start_time !== event.end_time, {
    message: "start_time and end_time must differ — ambiguous otherwise",
    path: ["end_time"],
  });

export type ScheduleEvent = z.infer<typeof scheduleEventSchema>;

export const scheduleEventsSchema = z.array(scheduleEventSchema).default([]);

// `default_inactive`'s two behaviors (see the plan's Data Model section):
// false (default) falls through to the global fallback baseline when no
// event matches; true instead treats every assigned zone as `inactive` for
// an unassigned window rather than handing it a fallback setpoint at all.
export const scheduleConfigSchema = z.object({
  enabled: z.boolean().default(true),
  default_inactive: z.boolean().default(false),
  description: z.string().optional(),
});

export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;

export function resolveScheduleEvents(stored: unknown): ScheduleEvent[] {
  return scheduleEventsSchema.parse(stored ?? []);
}

export function resolveScheduleConfig(stored: unknown): ScheduleConfig {
  return scheduleConfigSchema.parse(stored ?? {});
}
