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
 *
 * Real thermostat cooling/heating differential, not a single static
 * boundary: `tolerance` is split into a symmetric band of ± tolerance/2
 * around the setpoint, and which edge governs depends on the *previous*
 * classification — a zone that's demanding keeps demanding until it
 * reaches the lower edge (deviation <= -tolerance/2), and a zone that's
 * satisfied doesn't demand again until it crosses the upper edge
 * (deviation > +tolerance/2). A single static boundary can't express this:
 * it would let a call terminate the instant a zone re-enters the band from
 * above, which is exactly what produced a room whose real average
 * temperature ran systematically warmer than its own setpoint — confirmed
 * live (a driving zone's own comfort band sat entirely above its
 * configured target, 72-73°F for a 72°F setpoint, never below it). A
 * `previousClassification` of `null` or `"unclassified_no_sensor"` gets
 * the same "no protected continuity to preserve yet" treatment
 * `stabilizeClassification` already gives these two cases — treated as
 * "was satisfied" (the upper edge), so a brand-new or just-recovered zone
 * doesn't demand until genuinely warm/cold enough to warrant it.
 */
export function classifyZone(params: {
  hasTemperatureSensor: boolean;
  state: HvacCallState;
  calibratedTemp: AbsoluteTemp;
  resolvedSetpoint: AbsoluteTemp;
  tolerance: TempDelta | null;
  previousClassification: ZoneClassification | null;
}): ZoneClassification {
  if (!params.hasTemperatureSensor) return "unclassified_no_sensor";
  const deviation = computeDeviation(
    params.state,
    params.calibratedTemp,
    params.resolvedSetpoint,
  );
  const halfToleranceC = (params.tolerance ?? 0) / 2;
  const wasDemanding = params.previousClassification === "demanding";
  const edge = wasDemanding ? -halfToleranceC : halfToleranceC;
  return deviation > edge ? "demanding" : "satisfied";
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
 *
 * A `previousClassification` of `"unclassified_no_sensor"` gets the same
 * immediate-adoption treatment, for a distinct reason: this dwell exists
 * to stop a *real, current* reading from flapping across a hairline
 * comfort boundary, not to throttle how quickly a zone is trusted again
 * once real data resumes after a gap (a stale sensor reading, or one that
 * was simply unavailable). A real, confirmed bug this fixes: the
 * per-zone Stale Sensor Reading Safeguard's own contract promises normal
 * control "resumes immediately" once a stale reading starts changing
 * again, but this dwell was also applying to that exact recovery
 * transition (`"unclassified_no_sensor"` → `"demanding"`/`"satisfied"`),
 * silently holding the zone excluded for a further
 * `stabilizationMinutes` after the data had already come back — a real
 * comfort delay for a `flair_smart_vent` zone (its vent stays pinned at
 * idle baseline that whole time) and a delayed reappearance in
 * driving-zone/no-improvement accounting either way.
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
    params.previousClassification === "unclassified_no_sensor" ||
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
