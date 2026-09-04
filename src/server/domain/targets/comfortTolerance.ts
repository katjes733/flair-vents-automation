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

export interface ClassificationStabilization {
  classification: ZoneClassification;
  pendingClassification: ZoneClassification | null;
  pendingSinceMs: number | null;
}

/**
 * Debounces the satisfied/demanding boundary itself — mirrors
 * spikeDetection.ts/occupancy.ts's own stabilization-dwell pattern. A real,
 * confirmed gap found live via shadow-mode evaluation: real sensor noise
 * (confirmed: a bedroom's own reading wobbling ~0.5°C around its setpoint
 * with nothing actually wrong) can flip the *raw* classification every
 * tick, and since a zone's idle_baseline_position commonly equals its
 * max_vent_position, any "demanding" tick — even a hairline one — snaps
 * the computed position straight back to fully open, undoing whatever
 * proportional closing had already happened. This is a separate, layered
 * fix from `minimum_comfort_tolerance_c` (which raises the deadband
 * itself) — this one holds the *classification* steady even when a real
 * temperature genuinely sits close enough to the boundary that noise still
 * crosses it occasionally.
 *
 * A `previousClassification` of `null` means the zone has never been
 * classified yet (a brand-new zone) — the raw value is adopted immediately
 * with no dwell, since there's nothing yet to protect continuity of.
 */
export function stabilizeClassification(params: {
  raw: ZoneClassification;
  previousClassification: ZoneClassification | null;
  previousPending: {
    classification: ZoneClassification;
    sinceMs: number;
  } | null;
  nowMs: number;
  stabilizationMinutes: number;
}): ClassificationStabilization {
  if (
    params.previousClassification === null ||
    params.raw === params.previousClassification
  ) {
    return {
      classification: params.raw,
      pendingClassification: null,
      pendingSinceMs: null,
    };
  }

  const sinceMs =
    params.previousPending?.classification === params.raw
      ? params.previousPending.sinceMs
      : params.nowMs;
  const dwellElapsedMinutes = (params.nowMs - sinceMs) / 60000;
  if (dwellElapsedMinutes >= params.stabilizationMinutes) {
    return {
      classification: params.raw,
      pendingClassification: null,
      pendingSinceMs: null,
    };
  }
  return {
    classification: params.previousClassification,
    pendingClassification: params.raw,
    pendingSinceMs: sinceMs,
  };
}
