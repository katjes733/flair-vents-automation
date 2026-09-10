import { z } from "zod";
import { genuinePartial } from "~/shared/schemas/zodPartial";

export const TOPOLOGY_MODES = [
  "single_stage",
  "two_stage",
  "variable_speed",
] as const;
export type TopologyMode = (typeof TOPOLOGY_MODES)[number];

// Every field here keys off `topologyMode`, never an equipment make/model —
// see "Equipment generality" in the implementation plan. All three of this
// house's air handlers are variable-speed Bosch Premium IDP units, hence the
// schema default; a future non-variable-speed handler just sets this
// explicitly, no code change required.
export const airHandlerConfigSchema = z.object({
  topology_mode: z.enum(TOPOLOGY_MODES).default("variable_speed"),
  // Undefined means "use the topology's default limit" — deliberately no
  // numeric default here. pressure/topologyLimits.ts itself doesn't ship
  // enforced numbers until the Domain Research Directive lands (see the
  // implementation plan), so this schema doesn't invent one either.
  pressure_cap_override_pct: z.number().min(0).max(100).optional(),
  // The universal, required-before-activation baseline (see
  // "Resolved Design Decisions" in the plan): nameplate tonnage is the one
  // input every user can realistically supply, unlike manufacturer-specific
  // fan-performance research. topologyLimits.ts derives both flow-rate
  // fields below from this alone when they're unset. Optional at the
  // schema level (so resolveAirHandlerConfig({}) doesn't throw) — actually
  // required before an air handler can be set active, enforced in
  // Config-time validation, mirroring assumed_fixed_position's pattern.
  tonnage_tons: z.number().positive().optional(),
  // Derived from tonnage_tons (~400 CFM/ton) when unset, not a static
  // schema default and not zone-count-based (an earlier zone-count formula
  // underestimated a real system's rated airflow by ~4x — see the plan).
  // `is_estimate` distinguishes that derived guess from a real
  // user-provided blower rating in the UI.
  blower_rated_flow_rate_lps: z.number().positive().optional(),
  blower_rated_flow_rate_is_estimate: z.boolean().default(true),
  // The equipment-protection floor — an absolute minimum aggregate airflow,
  // not a percentage-by-topology-mode lookup (the Domain Research Directive
  // found no source actually governs this that way; see the plan). Derived
  // from tonnage_tons (~300 CFM/ton) when unset; sourced per air handler
  // from whatever manufacturer research applies to its specific installed
  // equipment when available. Real for Upstairs: 708 L/s, derived from a
  // confirmed 5-ton Bosch IDS Premium Connected unit (no electric heat kit,
  // 300 CFM/ton floor) — see docs/hvac-pressure-research.md. Undefined
  // means "no real research yet for this handler" — topologyLimits.ts falls
  // back to the tonnage-derived estimate in that case.
  minimum_aggregate_flow_lps: z.number().positive().optional(),
  minimum_aggregate_flow_is_estimate: z.boolean().default(true),
  // Optional, per-air-handler overrides for the global (system_settings)
  // Away Mode setpoints/tolerance — undefined means "use the
  // installation-wide System Parameters value," exactly the same
  // undefined-means-fall-back-to-a-broader-default shape already used
  // above for the two flow-rate fields. A house with more than one active
  // air handler may want a different away comfort target per wing (e.g. a
  // rarely-used guest wing set warmer/more relaxed than the primary living
  // area) without changing the global default every other handler falls
  // back to.
  away_setpoint_cool_override: z.number().optional(),
  away_setpoint_heat_override: z.number().optional(),
  away_tolerance_override: z.number().positive().optional(),
  // Which channel this handler's driving setpoint push is delivered
  // through — see "Direct HomeKit Thermostat Control" in the plan.
  // "flair" (default) is today's only-ever-shipped path, confirmed broken
  // under System Mode "manual" (the mode this app's own vent control
  // needs); "homekit" delivers the identical computed pushedValue over a
  // direct local HAP connection instead, proven working end-to-end
  // against the real unit. Per-handler, not global, and never silently
  // falls back from one to the other — see the plan's "Explicitly
  // deferred" note on why an automatic fallback isn't built.
  //
  // Also gates whether any of this handler's zones read live sensor data
  // (temperature/occupancy) via HomeKit at all — see "Ecobee SmartSensor
  // Reading via HomeKit". Deliberately one combined switch, not two
  // independent ones: once a handler is fully committed to HomeKit for
  // setpoint delivery, every possible signal should come through that
  // same local, low-latency path rather than leaving sensor reads on
  // Flair's slower relay for no reason. A zone's own
  // `config.homekit_sensor_serial` is inert while this stays "flair".
  setpoint_delivery_mode: z.enum(["flair", "homekit"]).default("flair"),
});

export type AirHandlerConfig = z.infer<typeof airHandlerConfigSchema>;

export function resolveAirHandlerConfig(stored: unknown): AirHandlerConfig {
  return airHandlerConfigSchema.parse(stored ?? {});
}

// `.partial()` alone doesn't suppress a field's `.default()` — a minimal
// PATCH would otherwise be silently expanded to every default value
// (topology_mode back to "variable_speed", both `_is_estimate` flags back
// to true) once merged onto the existing row, wiping real, researched
// per-handler data on every edit that doesn't happen to touch every
// field. See zoneConfigPartialSchema/systemSettingsConfigPartialSchema for
// the identical, already-fixed bug in the other two config schemas.
export const airHandlerConfigPartialSchema = genuinePartial(
  airHandlerConfigSchema,
);
