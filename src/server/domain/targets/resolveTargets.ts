import {
  asTempDelta,
  type AbsoluteTemp,
  type TempDelta,
} from "~/shared/types/temperature";
import type { HvacCallState } from "~/server/domain/types";
import {
  resolveManualOverride,
  type StoredManualOverride,
} from "~/server/domain/targets/manualOverride";
import {
  resolveAwaySource,
  type AwaySource,
} from "~/server/domain/targets/awayMode";

export type TargetSource =
  "manual" | "away" | "schedule" | "fallback" | "inactive";

export interface ResolvedTarget {
  setpoint: AbsoluteTemp | null;
  tolerance: TempDelta | null;
  source: TargetSource;
  /** Set only when source is "manual" and the override kind is "position". */
  manualPositionPct: number | null;
}

export interface GoverningEvent {
  mode: "active" | "inactive";
  coolSetpoint: AbsoluteTemp | null;
  heatSetpoint: AbsoluteTemp | null;
  toleranceOverride: TempDelta | null;
}

/**
 * The Target Resolution Order: manual override (survives Away) → Away
 * Mode → active schedule event → fallback baseline (only when
 * default_inactive is false). A position-kind manual override bypasses
 * Steps 1-3's position math for that zone, but setpoint resolution keeps
 * running beneath it — a position override doesn't clear the zone's
 * setpoint entirely, since tolerance classification, spike detection, and
 * driving-zone candidacy all still need a real resolved setpoint. See
 * "Comfort tolerance & target resolution order".
 */
export function resolveZoneTargets(params: {
  zoneId: string;
  nowMs: number;
  manualOverride: StoredManualOverride | null;
  awaySource: AwaySource;
  awayTargets: { setpoint: AbsoluteTemp; tolerance: TempDelta };
  governingEvent: GoverningEvent | null;
  defaultInactive: boolean;
  fallback: { setpoint: AbsoluteTemp; tolerance: TempDelta | null };
  zoneTolerance: TempDelta | null;
  state: HvacCallState;
  // A resolved tolerance of unset/zero — including a schedule event's own
  // explicit `comfort_tolerance: 0`/unset — is floored up to at least this
  // value wherever a real setpoint is resolved. A real, confirmed gap: a
  // near-zero tolerance combined with ordinary sensor noise (~±0.5°C
  // observed live) flapped a zone's raw classification every tick, which
  // — for a zone whose idle_baseline_position equals its max_vent_position
  // — snapped position straight back to fully open on any hairline
  // "demanding" tick. See also stabilizeClassification, a second, layered
  // fix for the same underlying flapping.
  minimumComfortTolerance: TempDelta;
}): ResolvedTarget {
  const manual = resolveManualOverride(params.manualOverride, params.nowMs);
  const result: ResolvedTarget = manual
    ? manual.kind === "position"
      ? {
          ...resolveBeneathManual(params),
          source: "manual",
          manualPositionPct: manual.value,
        }
      : {
          setpoint: manual.value as AbsoluteTemp,
          tolerance: params.zoneTolerance,
          source: "manual",
          manualPositionPct: null,
        }
    : resolveBeneathManual(params);
  return applyMinimumToleranceFloor(result, params.minimumComfortTolerance);
}

/**
 * Skipped for "inactive" (setpoint === null) — there's no target to floor a
 * tolerance against, and "inactive" zones aren't classified at all. Also
 * skipped when the floor itself is disabled (minimum <= 0) — a real 0
 * genuinely means "no floor configured," and forcing an unset (null)
 * tolerance to a literal 0 would silently collapse "unset ⇒ tight
 * targeting" and "explicitly zero" into the same on-the-wire value, which
 * `resolveComfortTolerance`'s own contract explicitly treats as distinct.
 */
function applyMinimumToleranceFloor(
  target: ResolvedTarget,
  minimum: TempDelta,
): ResolvedTarget {
  if (target.setpoint === null || minimum <= 0) return target;
  return {
    ...target,
    tolerance: asTempDelta(Math.max(target.tolerance ?? 0, minimum)),
  };
}

function resolveBeneathManual(
  params: Omit<Parameters<typeof resolveZoneTargets>[0], "manualOverride">,
): ResolvedTarget {
  const away = resolveAwaySource(params.zoneId, params.awaySource);
  if (away) {
    return {
      setpoint: params.awayTargets.setpoint,
      tolerance: params.awayTargets.tolerance,
      source: "away",
      manualPositionPct: null,
    };
  }

  if (params.governingEvent) {
    if (params.governingEvent.mode === "inactive") {
      return {
        setpoint: null,
        tolerance: null,
        source: "inactive",
        manualPositionPct: null,
      };
    }
    const setpoint =
      params.state === "COOLING_CALL"
        ? params.governingEvent.coolSetpoint
        : params.governingEvent.heatSetpoint;
    return {
      setpoint,
      tolerance:
        params.governingEvent.toleranceOverride ?? params.zoneTolerance,
      source: "schedule",
      manualPositionPct: null,
    };
  }

  if (params.defaultInactive) {
    return {
      setpoint: null,
      tolerance: null,
      source: "inactive",
      manualPositionPct: null,
    };
  }

  return {
    setpoint: params.fallback.setpoint,
    tolerance: params.fallback.tolerance ?? params.zoneTolerance,
    source: "fallback",
    manualPositionPct: null,
  };
}
