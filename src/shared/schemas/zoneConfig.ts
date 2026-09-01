import { z } from "zod";

// Not a Postgres enum — synchronize() handles enum-type alterations badly,
// and the retrofit-conversion flow mutates this in place. Varchar column +
// Zod enum instead (Data Model / zones section).
export const VENT_HARDWARE_TYPES = [
  "flair_smart_vent",
  "manual_fixed_vent",
  "no_vent",
] as const;
export type VentHardwareType = (typeof VENT_HARDWARE_TYPES)[number];
export const ventHardwareTypeSchema = z.enum(VENT_HARDWARE_TYPES);

// Sanity bounds from Config-time validation in the implementation plan —
// each is a Celsius/L-s conversion of the spec's original Fahrenheit/CFM
// figure, not a re-derived number.
export const COMFORT_TOLERANCE_MAX_C = 5.56; // 10°F sanity bound
export const SENSOR_CALIBRATION_OFFSET_MAX_C = 2.78; // ±5°F sanity bound
export const DUCT_FLOW_RATE_MAX_LPS = 944; // ~2000 CFM sanity bound

export const THERMAL_LOAD_FLAGS = [
  "high_internal_heat_load",
  "distant_high_duct_loss",
] as const;
export type ThermalLoadFlag = (typeof THERMAL_LOAD_FLAGS)[number];

// Every field here is genuinely optional/JSONB per the Data Model's
// column-vs-JSONB decisions — never a WHERE predicate. vent_hardware_type,
// name, flair_room_id etc. are their own columns and live outside this
// schema. Every field carries a Zod `.default()` so `resolveZoneConfig`
// works against `{}` with zero backfill required when a new tunable is added.
export const zoneConfigSchema = z.object({
  has_temperature_sensor: z.boolean().default(false),
  has_occupancy_sensor: z.boolean().default(false),
  // Required only when vent_hardware_type === "manual_fixed_vent" — enforced
  // in validateConfig (a cross-field rule Zod alone can't express cleanly),
  // not here.
  assumed_fixed_position: z.number().min(0).max(100).optional(),
  duct_flow_rate_lps: z
    .number()
    .finite()
    .positive()
    .max(DUCT_FLOW_RATE_MAX_LPS)
    .optional(),
  // Empty array = "standard" (no special thermal load). Both flags can be
  // set simultaneously — they aren't mutually exclusive.
  thermal_load_flags: z.array(z.enum(THERMAL_LOAD_FLAGS)).default([]),
  idle_baseline_position: z.number().min(0).max(100).default(100),
  // Unset (undefined) means "tight targeting" — a real, distinct state from
  // 0, which is why this has no `.default()`: defaulting it to 0 would
  // silently collapse "unset" and "explicitly zero" into the same value.
  comfort_tolerance: z.number().min(0).max(COMFORT_TOLERANCE_MAX_C).optional(),
  sensor_calibration_offset: z
    .number()
    .min(-SENSOR_CALIBRATION_OFFSET_MAX_C)
    .max(SENSOR_CALIBRATION_OFFSET_MAX_C)
    .default(0),
  min_vent_position: z.number().min(0).max(100).default(0),
  max_vent_position: z.number().min(0).max(100).default(100),
  // The zone's Flair vents to actuate — separate from flair_room_id, which
  // anchors room-scoped sensor data (temperature/occupancy) only. A Flair
  // room can have more than one vent (docs/flair-api-schema.md); every
  // vent in this list is commanded to the same computed target position
  // ("ganged" — see "Multi-Vent Zones" in the implementation plan).
  flair_vent_ids: z.array(z.string()).default([]),
});

export type ZoneConfig = z.infer<typeof zoneConfigSchema>;

export function resolveZoneConfig(stored: unknown): ZoneConfig {
  return zoneConfigSchema.parse(stored ?? {});
}
