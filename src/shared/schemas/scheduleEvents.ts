import { z } from "zod";
import { COMFORT_TOLERANCE_MAX_C } from "~/shared/schemas/zoneConfig";

// Bit 0 = Sunday ... bit 6 = Saturday. Wraparound windows (e.g. 20:30–07:00)
// use the day the window *starts*, per the Scheduling Engine section.
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

// One row per zone assigned to an event — replaces a flat
// assigned_zone_ids array + a single event-wide cool/heat setpoint pair +
// a separate comfort_tolerance_overrides map (see "Resolved Design
// Decisions" / Data Model in the implementation plan for why the earlier
// one-setpoint-per-event rule was superseded): a single time window (e.g.
// a 9pm-7am "night" period) commonly needs a genuinely different
// setpoint, tolerance, and occupancy-assumption per room, not just a
// shared value with a few zone-keyed exceptions.
export const zoneScheduleSettingSchema = z.object({
  zone_id: z.string().uuid(),
  // Required for an "active" event, meaningless for "inactive" ones —
  // enforced in validateConfig, mirroring assumed_fixed_position's
  // pattern, not expressible cleanly here since it depends on the
  // sibling event's `mode`.
  cool_setpoint: z.number().optional(),
  heat_setpoint: z.number().optional(),
  // Unset ⇒ tight targeting — the same "unset is not zero" semantics
  // comfort_tolerance_overrides always had.
  comfort_tolerance: z.number().min(0).max(COMFORT_TOLERANCE_MAX_C).optional(),
  // "Sleep Mode": forces occupied=true for this zone for as long as this
  // event is active, regardless of what the occupancy sensor reports.
  // PIR-based sensing cannot detect a motionless, sleeping person — see
  // "Occupancy" in the implementation plan for why this has to be a
  // schedule-time override rather than a sensor fix.
  assume_occupied: z.boolean().default(false),
});

export type ZoneScheduleSetting = z.infer<typeof zoneScheduleSettingSchema>;

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
    // A zone is "assigned" to this event by having a row here — no
    // separate assigned_zone_ids list to keep in sync with it.
    zone_settings: z.array(zoneScheduleSettingSchema).default([]),
    // "Advanced" overrides, scoped to this event/time-window only — a
    // different kind of concern (contention ranking, driving-zone
    // pinning) than any individual zone's own row above, so these stay
    // separate rather than folding into zone_settings.
    zone_priority_order: z.array(z.string().uuid()).optional(),
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
