// Cross-cutting shapes shared by more than one domain module. Not named in
// the implementation plan's module layout table (which lists function
// names, not every internal type), but keeping them in one place avoids
// each module redeclaring the same handful of vocabulary types.

export type ZoneId = string;

export type HvacCallState = "COOLING_CALL" | "HEATING_CALL";
export type HvacIdleState = "IDLE" | "FAN_ONLY";
export type HvacState = HvacCallState | HvacIdleState;

/**
 * The cool/heat side to use wherever a function genuinely needs a real
 * `HvacCallState` but the actual HVAC state is IDLE/FAN_ONLY — no call is
 * active, so there's no true "which side" to pick. Both
 * `position/pipeline.ts` (classifyZone's `state` during idle) and
 * `targets/resolveTargets.ts` (the schedule event's cool/heat setpoint
 * selection) need this identical arbitrary default, so it's named once
 * here rather than each hardcoding its own literal — a mismatch between
 * the two would be a real, confirmed bug (see "Stage 13, Increment B"'s
 * shadow-mode evaluation, which caught `resolveZoneTargets` silently
 * resolving the *heat* setpoint on every idle tick via an `as` cast that
 * lied about `hvac.state` always being a real call state).
 */
export const ARBITRARY_IDLE_CALL_STATE: HvacCallState = "COOLING_CALL";

// Gated on has_temperature_sensor, independent of vent hardware type — see
// "Comfort tolerance & target resolution order".
export type ZoneClassification =
  "satisfied" | "demanding" | "unclassified_no_sensor";

export interface ModifierBoosts {
  occupancy: number;
  spike: number;
  highInternalHeatLoad: number;
  distantHighDuctLoss: number;
}
