// Cross-cutting shapes shared by more than one domain module. Not named in
// the implementation plan's module layout table (which lists function
// names, not every internal type), but keeping them in one place avoids
// each module redeclaring the same handful of vocabulary types.

export type ZoneId = string;

export type HvacCallState = "COOLING_CALL" | "HEATING_CALL";
export type HvacIdleState = "IDLE" | "FAN_ONLY";
export type HvacState = HvacCallState | HvacIdleState;

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
