import { z } from "zod";
import {
  ventHardwareTypeSchema,
  zoneConfigSchema,
} from "~/shared/schemas/zoneConfig";

// Serves both the Express validateBody middleware and the React
// AddZoneDialog/ZoneConfigTable forms — one rule set, not two
// independently-drifting copies. name/air_handler_id/vent_hardware_type
// are their own DB columns (see Data Model), not part of zoneConfigSchema,
// so this combines them with the config sub-object explicitly.
export const createZoneRequestSchema = z.object({
  air_handler_id: z.string().uuid(),
  flair_room_id: z.string().nullable().default(null),
  name: z.string().min(1).max(255),
  vent_hardware_type: ventHardwareTypeSchema,
  config: zoneConfigSchema.default(zoneConfigSchema.parse({})),
});

export type CreateZoneRequest = z.infer<typeof createZoneRequestSchema>;

export const updateZoneRequestSchema = z.object({
  air_handler_id: z.string().uuid().optional(),
  name: z.string().min(1).max(255).optional(),
  vent_hardware_type: ventHardwareTypeSchema.optional(),
  config: zoneConfigSchema.partial().optional(),
});

export type UpdateZoneRequest = z.infer<typeof updateZoneRequestSchema>;
