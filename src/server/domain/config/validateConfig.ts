import type { VentHardwareType } from "~/shared/schemas/zoneConfig";

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

const TONNAGE_MIN = 0.5;
const TONNAGE_MAX = 25;

/**
 * `flair_room_id` is allowed regardless of `vent_hardware_type`. Earlier
 * versions of this rule restricted it to `flair_smart_vent`/`no_vent` on
 * the theory that a `manual_fixed_vent` zone is "always a manually-added
 * local zone" with no reason to track live Flair room data — that
 * invariant turned out to be wrong for a real, common case: a room can
 * have a plain, non-Flair-controlled vent while still carrying a live
 * Flair-tracked sensor (temperature/occupancy via a remote sensor) for
 * that same room. `flair_room_id` only ever anchors sensor data — it has
 * no bearing on whether the vent itself is smart-controlled — so there's
 * no cross-field conflict to reject here for any vent hardware type.
 * `flair_vent_ids` (now `flair_vents`) non-empty requires
 * `flair_smart_vent`, and a `flair_smart_vent` zone requires at least one
 * vent — see "Multi-Vent Zones"/"Multi-Vent Manual Zones" (each vent now
 * carries its own optional duct rating, but the id-presence rule itself
 * is unchanged); `manual_vents` requires at least one entry iff
 * manual_fixed_vent, rejected (must be empty) on other types — see
 * "Multi-Vent Manual Zones"; the old zone-level `duct_flow_rate_lps`
 * field no longer exists at all (retired once every vent-having type
 * moved to a per-vent rating, with nothing left to apply it to);
 * min/max_vent_position ordering; idle_baseline_position within [min,max]
 * rejected, never silently clamped — see "Config-time validation".
 */
export function validateZoneConfig(zone: {
  ventHardwareType: VentHardwareType;
  flairRoomId: string | null;
  flairVentIds: string[];
  manualVents: Array<{ position: number; ductFlowRateLps: number | undefined }>;
  minVentPosition: number;
  maxVentPosition: number;
  idleBaselinePosition: number;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (zone.ventHardwareType === "flair_smart_vent") {
    if (zone.flairVentIds.length === 0) {
      issues.push({
        code: "flair_smart_vent_requires_vent_ids",
        severity: "error",
        message: "A flair_smart_vent zone requires at least one flair_vent_id.",
      });
    }
  } else if (zone.flairVentIds.length > 0) {
    issues.push({
      code: "flair_vent_ids_not_applicable",
      severity: "error",
      message: "flair_vent_ids only applies to flair_smart_vent zones.",
    });
  }

  if (zone.ventHardwareType === "manual_fixed_vent") {
    if (zone.manualVents.length === 0) {
      issues.push({
        code: "manual_vents_required",
        severity: "error",
        message: "A manual_fixed_vent zone requires at least one manual vent.",
      });
    }
  } else if (zone.manualVents.length > 0) {
    issues.push({
      code: "manual_vents_not_applicable",
      severity: "error",
      message: "manual_vents only applies to manual_fixed_vent zones.",
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
