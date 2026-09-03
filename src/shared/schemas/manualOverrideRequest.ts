import { z } from "zod";
import { HOLD_TYPES } from "~/shared/schemas/manualOverride";

// zone_id and hold_type are request-only concerns (hold_type drives the
// server-computed expires_at; it isn't itself part of the stored config —
// see manualOverride.ts's own config shape) so this is a distinct schema
// from manualOverrideConfigSchema, not a variant of it.
export const createManualOverrideRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("setpoint"),
    zone_id: z.string().uuid(),
    value: z.number(),
    hold_type: z.enum(HOLD_TYPES),
    actor: z.string().min(1),
    note: z.string().optional(),
  }),
  z.object({
    kind: z.literal("position"),
    zone_id: z.string().uuid(),
    value: z.number().min(0).max(100),
    hold_type: z.enum(HOLD_TYPES),
    actor: z.string().min(1),
    note: z.string().optional(),
  }),
]);

export type CreateManualOverrideRequest = z.infer<
  typeof createManualOverrideRequestSchema
>;
