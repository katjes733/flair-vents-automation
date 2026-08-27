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
  // Seeded at creation time (zone count × settings.defaultZoneFlowRateLps),
  // not a static schema default — see "Resolved Design Decisions" in the
  // plan. `is_estimate` distinguishes that seeded guess from a real
  // user-provided blower rating in the UI.
  blower_rated_flow_rate_lps: z.number().positive().optional(),
  blower_rated_flow_rate_is_estimate: z.boolean().default(true),
});

export type AirHandlerConfig = z.infer<typeof airHandlerConfigSchema>;

export function resolveAirHandlerConfig(stored: unknown): AirHandlerConfig {
  return airHandlerConfigSchema.parse(stored ?? {});
}
