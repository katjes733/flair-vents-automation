import { z } from "zod";

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
});

export type AirHandlerConfig = z.infer<typeof airHandlerConfigSchema>;

export function resolveAirHandlerConfig(stored: unknown): AirHandlerConfig {
  return airHandlerConfigSchema.parse(stored ?? {});
}
