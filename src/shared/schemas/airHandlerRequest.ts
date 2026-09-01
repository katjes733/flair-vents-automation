import { z } from "zod";
import { airHandlerConfigSchema } from "~/shared/schemas/airHandlerConfig";

export const createAirHandlerRequestSchema = z.object({
  flair_zone_id: z.string().nullable().default(null),
  name: z.string().min(1).max(255),
  active: z.boolean().default(false),
  config: airHandlerConfigSchema.default(airHandlerConfigSchema.parse({})),
});

export type CreateAirHandlerRequest = z.infer<
  typeof createAirHandlerRequestSchema
>;

export const updateAirHandlerRequestSchema = z.object({
  flair_zone_id: z.string().nullable().optional(),
  name: z.string().min(1).max(255).optional(),
  active: z.boolean().optional(),
  config: airHandlerConfigSchema.partial().optional(),
});

export type UpdateAirHandlerRequest = z.infer<
  typeof updateAirHandlerRequestSchema
>;
