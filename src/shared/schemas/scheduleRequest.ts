import { z } from "zod";
import {
  zoneScheduleSettingSchema,
  scheduleConfigSchema,
} from "~/shared/schemas/scheduleEvents";

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

// id/created_at/modified_at are optional here and filled in server-side —
// the client never has to mint a uuid or a timestamp itself for a brand
// new event; only an *edited* existing event carries its own id forward
// (so its identity, and therefore the overlap tiebreak's per-event
// modified_at, survives the edit). See scheduleEventSchema in
// scheduleEvents.ts for why each event needs its own identity at all.
export const scheduleEventRequestSchema = z
  .object({
    id: z.string().uuid().optional(),
    mode: z.enum(["active", "inactive"]),
    start_time: z.string().regex(TIME_OF_DAY, "expected HH:MM"),
    end_time: z.string().regex(TIME_OF_DAY, "expected HH:MM"),
    days_of_week: z.number().int().min(0).max(0b1111111),
    zone_settings: z.array(zoneScheduleSettingSchema).default([]),
    zone_priority_order: z.array(z.string().uuid()).optional(),
    driving_zone_overrides: z
      .record(z.string().uuid(), z.string().uuid())
      .optional(),
  })
  .refine((event) => event.start_time !== event.end_time, {
    message: "start_time and end_time must differ — ambiguous otherwise",
    path: ["end_time"],
  });

export type ScheduleEventRequest = z.infer<typeof scheduleEventRequestSchema>;

export const createScheduleRequestSchema = z.object({
  name: z.string().min(1).max(255),
  events: z.array(scheduleEventRequestSchema).default([]),
  config: scheduleConfigSchema.default(scheduleConfigSchema.parse({})),
});

export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;

export const updateScheduleRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  events: z.array(scheduleEventRequestSchema).optional(),
  config: scheduleConfigSchema.partial().optional(),
});

export type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>;
