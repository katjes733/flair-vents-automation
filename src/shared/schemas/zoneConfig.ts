import { z } from "zod";
import { genuinePartial } from "~/shared/schemas/zodPartial";

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

// One physical manual vent — see manual_vents' own comment below for why
// each gets its own position and (optional) duct rating rather than a
// single shared value for the whole zone.
export const manualVentSchema = z.object({
  position: z.number().min(0).max(100),
  duct_flow_rate_lps: z
    .number()
    .finite()
    .positive()
    .max(DUCT_FLOW_RATE_MAX_LPS)
    .optional(),
});
export type ManualVent = z.infer<typeof manualVentSchema>;

// One Flair-controlled smart vent — its own identity plus (optionally) its
// own duct rating. See flair_vents' own comment below for why this carries
// a rating per vent even though every vent in the zone is still commanded
// to the same ganged target position.
export const flairVentSchema = z.object({
  flair_vent_id: z.string(),
  duct_flow_rate_lps: z
    .number()
    .finite()
    .positive()
    .max(DUCT_FLOW_RATE_MAX_LPS)
    .optional(),
});
export type FlairVentConfig = z.infer<typeof flairVentSchema>;

// Every field here is genuinely optional/JSONB per the Data Model's
// column-vs-JSONB decisions — never a WHERE predicate. vent_hardware_type,
// name, flair_room_id etc. are their own columns and live outside this
// schema. Every field carries a Zod `.default()` so `resolveZoneConfig`
// works against `{}` with zero backfill required when a new tunable is added.
export const zoneConfigSchema = z.object({
  has_temperature_sensor: z.boolean().default(false),
  has_occupancy_sensor: z.boolean().default(false),
  // Every physical manual vent in this zone, each with its own fixed
  // position and (optionally) its own duct airflow rating. Supersedes an
  // earlier design (a single assumed_fixed_position + a bare
  // manual_vent_count) that could represent "how many" but not "at what
  // position each" — a real house confirmed vents in the same room can
  // genuinely sit at different open amounts (e.g. one bathroom vent
  // smaller/less-open than its sibling), which a single shared position
  // can't express. Unlike flair_vents' still-ganged "one computed
  // target for every vent" model — smart vents have real dispatch cost
  // and no individual identity worth tracking separately here — a manual
  // vent's position is set by hand with zero dispatch cost either way, so
  // there's no reason to force them to match. Required to have at least
  // one entry for a manual_fixed_vent zone, and must be empty for every
  // other type (validateConfig, mirroring this field's own predecessor's
  // pattern). Each vent's own duct_flow_rate_lps independently falls back
  // to the standard-duct default when unset — a deliberate change from the
  // old design: two vents both left blank now correctly assume roughly
  // double a single vent's default capacity, not one combined default for
  // the whole zone. See "Multi-Vent Manual Zones".
  manual_vents: z.array(manualVentSchema).default([]),
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
  // vent in this list is still commanded to the same computed target
  // position ("ganged" — see "Multi-Vent Zones") — that constraint is
  // unchanged. What changed (see "Multi-Vent Manual Zones"): this used to
  // be a bare `string[]` with one shared zone-level `duct_flow_rate_lps`
  // for every vent combined, which required manually summing each vent's
  // own capacity into one number. Each vent now carries its own optional
  // rating instead — falling back to the standard-duct default when
  // unset, same as before, just per vent rather than per zone. This is
  // safe precisely because ganged position means every vent in the zone
  // is always at the same commanded %, so the aggregate contribution is
  // still just (that %) × (sum of each vent's own rating) — no change to
  // the position math itself, only to how its combined rating is entered
  // and stored. Required to have at least one entry for a
  // flair_smart_vent zone, and must be empty for every other type
  // (validateConfig, unchanged from this field's own original rule).
  flair_vents: z.array(flairVentSchema).default([]),
  // Pure UI concern — the user's own drag/arrow-reordered position among
  // the other zones on the same air handler's dashboard grid. Never a
  // domain/control input (no relation to zone_priority_order, which is a
  // genuinely different concept — contention-resolution priority, not
  // visual arrangement). Ties (including every zone's shared default of
  // 0) fall back to whatever order the zone list already arrived in,
  // since array sorts are stable.
  display_order: z.number().default(0),
});

export type ZoneConfig = z.infer<typeof zoneConfigSchema>;

export function resolveZoneConfig(stored: unknown): ZoneConfig {
  return zoneConfigSchema.parse(stored ?? {});
}

/**
 * A genuine partial of `zoneConfigSchema` for PATCH request bodies —
 * `zoneConfigSchema.partial()` alone is NOT safe for this, because Zod's
 * `.default()` still substitutes each field's default value for an
 * omitted key even once the field is wrapped `.optional()` by
 * `.partial()`. Confirmed directly: `zoneConfigSchema.partial().parse({
 * display_order: 1 })` produces a fully-populated object (`flair_vent_ids:
 * []`, `has_temperature_sensor: false`, ...), not `{ display_order: 1 }`
 * alone — silently reintroducing every other field's default. Once merged
 * onto an existing row (`{...existing.config, ...patch.config}` in
 * `zoneService.ts`), that wipes every field the caller never intended to
 * touch. Unwrapping each field's `.default()` before partializing is what
 * makes an omitted key stay genuinely absent. Found live: a zone-card
 * reorder (which only ever needs to patch `display_order`) was rejecting
 * every multi-vent zone as "requires at least one flair_vent_id" — the
 * merge had already silently emptied `flair_vent_ids` before validation
 * ever saw it. `genuinePartial()` (shared/schemas/zodPartial.ts) is the
 * general form of this fix, extracted once `systemSettingsConfigSchema`
 * needed the identical treatment for the exact same reason.
 */
export const zoneConfigPartialSchema = genuinePartial(zoneConfigSchema);
