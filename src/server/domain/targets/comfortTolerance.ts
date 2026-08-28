import {
  asTempDelta,
  type AbsoluteTemp,
  type TempDelta,
} from "~/shared/types/temperature";
import type { HvacCallState, ZoneClassification } from "~/server/domain/types";

/**
 * schedule-event override → zone default → none. Unset (`null`) is a
 * distinct state from an explicit zero — collapsing them would silently
 * turn "no tolerance configured" into "zero tolerance," which is why this
 * doesn't default to 0 itself; classifyZone below is where "unset ⇒ tight
 * targeting" actually applies.
 */
export function resolveComfortTolerance(
  zoneToleranceC: TempDelta | null,
  scheduleOverrideC: TempDelta | null,
): TempDelta | null {
  return scheduleOverrideC ?? zoneToleranceC ?? null;
}

export function computeDeviation(
  state: HvacCallState,
  calibratedTemp: AbsoluteTemp,
  resolvedSetpoint: AbsoluteTemp,
): TempDelta {
  return asTempDelta(
    state === "COOLING_CALL"
      ? calibratedTemp - resolvedSetpoint
      : resolvedSetpoint - calibratedTemp,
  );
}

/**
 * satisfied/demanding classification — gated on sensor presence,
 * independent of vent hardware type (a sensored hallway with no vent is
 * legitimately classifiable). Governs per-zone vent allocation only, never
 * equipment-call logic — see "Comfort tolerance & target resolution
 * order".
 */
export function classifyZone(params: {
  hasTemperatureSensor: boolean;
  state: HvacCallState;
  calibratedTemp: AbsoluteTemp;
  resolvedSetpoint: AbsoluteTemp;
  tolerance: TempDelta | null;
}): ZoneClassification {
  if (!params.hasTemperatureSensor) return "unclassified_no_sensor";
  const deviation = computeDeviation(
    params.state,
    params.calibratedTemp,
    params.resolvedSetpoint,
  );
  const toleranceC = params.tolerance ?? 0;
  return deviation > toleranceC ? "demanding" : "satisfied";
}
