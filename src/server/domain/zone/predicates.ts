import type { VentHardwareType } from "~/shared/schemas/zoneConfig";

// The single source of truth for hardware-type-gated behavior — see "Zone
// Hardware & Sensor Type Matrix" in the implementation plan. Call sites
// test these predicates rather than re-testing vent_hardware_type inline.

/** Has an actual vent this app can command a position on. */
export function isControllable(ventHardwareType: VentHardwareType): boolean {
  return ventHardwareType === "flair_smart_vent";
}

/** Occupies duct area and counts toward the pressure aggregate. */
export function contributesToPressure(
  ventHardwareType: VentHardwareType,
): boolean {
  return ventHardwareType !== "no_vent";
}

/**
 * Tolerance/classification/spike/driving-zone eligibility is gated on
 * sensor presence, never vent type — a sensored hallway with no vent is
 * legitimately classifiable.
 */
export function isSensored(hasTemperatureSensor: boolean): boolean {
  return hasTemperatureSensor;
}

/** Eligible to be tracked as the driving (setpoint-push) zone. */
export function isDrivingCandidate(params: {
  hasTemperatureSensor: boolean;
  stale: boolean;
  demanding: boolean;
}): boolean {
  return params.hasTemperatureSensor && !params.stale && params.demanding;
}
