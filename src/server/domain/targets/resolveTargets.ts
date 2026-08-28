import type { AbsoluteTemp, TempDelta } from "~/shared/types/temperature";
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
}): ResolvedTarget {
  const manual = resolveManualOverride(params.manualOverride, params.nowMs);
  if (manual) {
    if (manual.kind === "position") {
      const beneath = resolveBeneathManual(params);
      return { ...beneath, source: "manual", manualPositionPct: manual.value };
    }
    return {
      setpoint: manual.value as AbsoluteTemp,
      tolerance: params.zoneTolerance,
      source: "manual",
      manualPositionPct: null,
    };
  }
  return resolveBeneathManual(params);
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
