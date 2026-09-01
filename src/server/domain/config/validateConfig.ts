import type { VentHardwareType } from "~/shared/schemas/zoneConfig";

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

const TONNAGE_MIN = 0.5;
const TONNAGE_MAX = 25;

/**
 * `flair_room_id` non-null requires `flair_smart_vent` (the spec's
 * "always a manually-added local zone" invariant for
 * manual_fixed_vent/no_vent — the retrofit-conversion flow is the one
 * sanctioned exception, applied one layer up, not here);
 * assumed_fixed_position required iff manual_fixed_vent, rejected on other
 * types; min/max_vent_position ordering; idle_baseline_position within
 * [min,max] rejected, never silently clamped — see "Config-time
 * validation".
 */
export function validateZoneConfig(zone: {
  ventHardwareType: VentHardwareType;
  flairRoomId: string | null;
  assumedFixedPosition: number | undefined;
  minVentPosition: number;
  maxVentPosition: number;
  idleBaselinePosition: number;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (
    zone.flairRoomId !== null &&
    zone.ventHardwareType !== "flair_smart_vent"
  ) {
    issues.push({
      code: "flair_room_requires_smart_vent",
      severity: "error",
      message:
        "A zone linked to a Flair room must be vent_hardware_type flair_smart_vent.",
    });
  }

  if (zone.ventHardwareType === "manual_fixed_vent") {
    if (zone.assumedFixedPosition === undefined) {
      issues.push({
        code: "assumed_fixed_position_required",
        severity: "error",
        message:
          "assumed_fixed_position is required for a manual_fixed_vent zone.",
      });
    }
  } else if (zone.assumedFixedPosition !== undefined) {
    issues.push({
      code: "assumed_fixed_position_not_applicable",
      severity: "error",
      message:
        "assumed_fixed_position only applies to manual_fixed_vent zones.",
    });
  }

  if (zone.minVentPosition > zone.maxVentPosition) {
    issues.push({
      code: "min_exceeds_max",
      severity: "error",
      message: "min_vent_position cannot exceed max_vent_position.",
    });
  }

  if (
    zone.idleBaselinePosition < zone.minVentPosition ||
    zone.idleBaselinePosition > zone.maxVentPosition
  ) {
    issues.push({
      code: "idle_baseline_out_of_range",
      severity: "error",
      message:
        "idle_baseline_position must fall within [min_vent_position, max_vent_position].",
    });
  }

  return issues;
}

/**
 * `tonnage_tons` is required before an air handler can be set active — the
 * universal baseline the pressure safeguard cannot safely do without, per
 * "Resolved Design Decisions". Sanity bounds are deliberately generous
 * (0.5-25 tons spans anything from a single mini-split zone to a large
 * commercial-scale residential system) since this is a typo/misconfig
 * guard, not an attempt to second-guess a real nameplate value.
 */
export function validateAirHandlerConfig(config: {
  active: boolean;
  tonnageTons: number | undefined;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (config.active && config.tonnageTons === undefined) {
    issues.push({
      code: "tonnage_required_when_active",
      severity: "error",
      message:
        "tonnage_tons is required before an air handler can be set active — the pressure safeguard's universal baseline.",
    });
  }

  if (
    config.tonnageTons !== undefined &&
    (config.tonnageTons < TONNAGE_MIN || config.tonnageTons > TONNAGE_MAX)
  ) {
    issues.push({
      code: "tonnage_out_of_range",
      severity: "error",
      message: `tonnage_tons must be between ${TONNAGE_MIN} and ${TONNAGE_MAX} tons.`,
    });
  }

  return issues;
}

/**
 * The spec's own stated defaults (min_step_delta=15%, modulation_step=10%
 * x max_steps_per_tick=1) would otherwise deadlock the vents — kept as a
 * warning, not a rejection, since the step-delta-vs-last-dispatched fix
 * (see "Resolved Design Decisions") makes the combination merely slower to
 * dispatch, not broken.
 */
export function validateStepDeltaRelationship(params: {
  minStepDeltaPct: number;
  modulationStepPct: number;
  maxStepsPerTick: number;
}): ValidationIssue[] {
  if (
    params.minStepDeltaPct >
    params.modulationStepPct * params.maxStepsPerTick
  ) {
    return [
      {
        code: "step_delta_deadlock_risk",
        severity: "warning",
        message:
          "min_step_delta_pct exceeds a single ramp step's max movement — dispatch will accumulate across multiple ticks before triggering.",
      },
    ];
  }
  return [];
}

/**
 * sleep_mode_min_step_delta_pct only does anything if it's actually wider
 * than the normal dispatch threshold it's meant to replace during Sleep
 * Mode — a value at or below min_step_delta_pct is silently a no-op, so
 * this is worth flagging even though it can't break anything.
 */
export function validateSleepModeStepDelta(params: {
  minStepDeltaPct: number;
  sleepModeMinStepDeltaPct: number;
}): ValidationIssue[] {
  if (params.sleepModeMinStepDeltaPct <= params.minStepDeltaPct) {
    return [
      {
        code: "sleep_mode_step_delta_no_effect",
        severity: "warning",
        message:
          "sleep_mode_min_step_delta_pct is not wider than min_step_delta_pct — quiet actuation during Sleep Mode will have no effect.",
      },
    ];
  }
  return [];
}

/** No duplicate zone ids, and — the caller supplies existence — every id resolves. */
export function validatePriorityOrder(
  zonePriorityOrder: string[],
  knownZoneIds: ReadonlySet<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const zoneId of zonePriorityOrder) {
    if (seen.has(zoneId)) {
      issues.push({
        code: "priority_order_duplicate",
        severity: "error",
        message: `Zone ${zoneId} appears more than once in the priority order.`,
      });
    }
    seen.add(zoneId);
    if (!knownZoneIds.has(zoneId)) {
      issues.push({
        code: "priority_order_unknown_zone",
        severity: "error",
        message: `Zone ${zoneId} in the priority order does not exist.`,
      });
    }
  }
  return issues;
}
