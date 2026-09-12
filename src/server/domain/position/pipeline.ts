import type {
  VentHardwareType,
  ThermalLoadFlag,
} from "~/shared/schemas/zoneConfig";
import type { AbsoluteTemp, TempDelta } from "~/shared/types/temperature";
import {
  ARBITRARY_IDLE_CALL_STATE,
  type HvacState,
  type ModifierBoosts,
  type ZoneClassification,
} from "~/server/domain/types";
import {
  classifyZone,
  stabilizeClassification,
} from "~/server/domain/targets/comfortTolerance";
import { computeDesiredPosition } from "~/server/domain/position/step1DesiredPosition";
import { effectiveIdleBaseline } from "~/server/domain/sensors/occupancy";
import {
  rankZones,
  resolveContention,
  type ContentionResult,
  type ContentionBucket,
} from "~/server/domain/position/step3Contention";
import { rampTowardTarget } from "~/server/domain/position/step2Ramp";
import { clampToPressureFloor } from "~/server/domain/pressure/pressureSafeguard";
import { clampToZoneRange } from "~/server/domain/position/clamp";

export interface PipelineZoneInput {
  zoneId: string;
  ventHardwareType: VentHardwareType;
  hasTemperatureSensor: boolean;
  minVentPosition: number;
  maxVentPosition: number;
  idleBaselinePosition: number;
  thermalLoadFlags: ThermalLoadFlag[];
  flowRateLps: number; // flair_smart_vent only — see manualVents below
  // manual_fixed_vent only — each vent's own fixed position and resolved
  // (default-applied) duct rating. A zone can have more than one, each at
  // a genuinely different position — see "Multi-Vent Manual Zones".
  manualVents: Array<{ position: number; flowRateLps: number }>;
  calibratedTemp: AbsoluteTemp;
  resolvedSetpoint: AbsoluteTemp | null; // null = "inactive" — no target this tick
  tolerance: TempDelta | null;
  occupied: boolean;
  staleOccupancy: boolean;
  staleReading: boolean;
  spiking: boolean;
  priorityRank: number;
  lastCommandedTarget: number | null;
  manualPositionPct: number | null;
  degraded: boolean;
  // Hysteresis inputs for the satisfied/demanding classification boundary
  // itself — see stabilizeClassification. previousClassification is the
  // prior tick's own *stabilized* result (zone.state.last_classification);
  // previousPendingClassification/previousPendingSinceMs mirror
  // spike_active/spike_since's shape (zone.state.classification_pending_*).
  previousClassification: ZoneClassification | null;
  previousPendingClassification: ZoneClassification | null;
  previousPendingSinceMs: number | null;
  // Sleep-mode quiet anchor inputs — see sleep_quiet_anchor_enabled's own
  // comment in systemSettings.ts. sleepModeActive mirrors the zone's
  // currently-active schedule event's assume_occupied flag (control/tick.ts's
  // sleepModeActiveByZone), not the live occupancy signal.
  sleepModeActive: boolean;
  priorAnchorPositionPct: number | null;
  priorAnchorSinceMs: number | null;
  // Capacity sharing inputs — see capacity_sharing_enabled's own comment in
  // systemSettings.ts. otherZoneStruggling is computed by the caller from
  // *other* zones' persisted demand-tracking state (never this zone's
  // own — a struggling zone isn't asked to sacrifice itself for itself).
  otherZoneStruggling: boolean;
  capacitySharingExempt: boolean;
}

export interface PipelineResult {
  commandedPositions: Record<string, number>;
  classifications: Record<string, ZoneClassification | "inactive">;
  // The updated hysteresis-dwell state per zone, for the caller to persist
  // back to zone.state.classification_pending_value/_since — absent for a
  // zone that never ran through classifyZone this tick (inactive, a manual
  // position override, or a bypassed early-continue), which resets its
  // hysteresis to "nothing pending" on persist.
  classificationPending: Record<
    string,
    { value: ZoneClassification | null; sinceMs: number | null }
  >;
  // The updated sleep-quiet-anchor state per zone, for the caller to
  // persist back to zone.state.sleep_quiet_anchor_position/_since — mirrors
  // classificationPending's shape/contract. Both fields null for any zone
  // that isn't currently holding an anchor (demanding, sleep mode inactive,
  // or the feature disabled).
  sleepQuietAnchors: Record<
    string,
    { positionPct: number | null; sinceMs: number | null }
  >;
  contention: ContentionResult | null;
  pressureFloorClamped: boolean;
  insufficientFloor: boolean;
}

/**
 * Flow-weighted average across a manual_fixed_vent zone's own vents — the
 * one representation that keeps a purely-informational single "position"
 * mathematically consistent with the real per-vent aggregate contribution
 * (sum of position/100 * flowRateLps for each vent) it's derived from,
 * rather than a plain average that could disagree with it. Defensive
 * zero-division guard only — validateConfig requires at least one vent for
 * a manual_fixed_vent zone, so an empty array shouldn't reach here in
 * practice.
 */
function weightedManualVentPosition(
  vents: Array<{ position: number; flowRateLps: number }>,
): number {
  const totalFlowRateLps = vents.reduce((sum, v) => sum + v.flowRateLps, 0);
  if (totalFlowRateLps <= 0) return 0;
  return (
    vents.reduce((sum, v) => sum + v.position * v.flowRateLps, 0) /
    totalFlowRateLps
  );
}

/** Sum of each vent's own contribution — see weightedManualVentPosition. */
function manualVentAggregateLps(
  vents: Array<{ position: number; flowRateLps: number }>,
): number {
  return vents.reduce((sum, v) => sum + (v.position / 100) * v.flowRateLps, 0);
}

function bucketFor(
  state: HvacState,
  occupied: boolean,
  spiking: boolean,
): ContentionBucket {
  // The spiking bucket's rank privilege is COOLING_CALL-scoped — a spiking
  // zone in HEATING_CALL is already choked by Step 1, so it's ranked by
  // whichever of occupied/unoccupied it would otherwise fall into. The
  // occupied bucket's privilege is not state-scoped. See "Step 3" and
  // "Occupancy".
  if (spiking && state === "COOLING_CALL") return "spiking";
  return occupied ? "occupied" : "unoccupied";
}

/**
 * The single pure seam composing the whole per-tick position pipeline:
 * Step 1 -> Step 3 -> Step 2 -> a final pressure-floor clamp — see
 * "Pipeline ordering" for why this order (not the spec's literal 1->2->3
 * reading order) is correct. Manual position overrides and non-smart-vent
 * zones bypass the math entirely but still contribute to the pressure
 * aggregate where applicable.
 */
export function computeZoneCommands(params: {
  state: HvacState;
  zones: PipelineZoneInput[];
  nowMs: number;
  settings: {
    proportionalBandWidthC: TempDelta;
    maxPositionPct: number;
    modifierBoosts: ModifierBoosts;
    heatingChokePositionPct: number;
    unoccupiedIdleFactor: number;
    modulationStepPct: number;
    maxStepsPerTick: number;
    classificationStabilizationMinutes: number;
    sleepQuietAnchorEnabled: boolean;
    reanchorIntervalMinutes: number;
    capacitySharingEnabled: boolean;
  };
  capLps: number;
  floorLps: number;
}): PipelineResult {
  const callActive =
    params.state === "COOLING_CALL" || params.state === "HEATING_CALL";
  const commandedPositions: Record<string, number> = {};
  const classifications: Record<string, ZoneClassification | "inactive"> = {};
  const classificationPending: PipelineResult["classificationPending"] = {};
  const sleepQuietAnchors: PipelineResult["sleepQuietAnchors"] = {};

  // Debounces a zone's raw classifyZone() output against its own prior
  // tick's stabilized result — see stabilizeClassification's own doc
  // comment for the real, confirmed bug this exists to fix (near-zero
  // tolerance + real sensor noise flapping demanding/satisfied every tick,
  // snapping a closing zone straight back to fully open). Every call site
  // that runs classifyZone routes its raw result through this, so the
  // classification stored in `classifications` — and the one Step 1 above
  // sees via `demanding` — is always the stabilized value, never the raw
  // one.
  function classifyWithStabilization(
    zone: PipelineZoneInput,
    raw: ZoneClassification,
  ): ZoneClassification {
    const result = stabilizeClassification({
      raw,
      previousClassification: zone.previousClassification,
      previousPending:
        zone.previousPendingClassification !== null &&
        zone.previousPendingSinceMs !== null
          ? {
              classification: zone.previousPendingClassification,
              sinceMs: zone.previousPendingSinceMs,
            }
          : null,
      nowMs: params.nowMs,
      stabilizationMinutes: params.settings.classificationStabilizationMinutes,
    });
    classificationPending[zone.zoneId] = {
      value: result.pendingClassification,
      sinceMs: result.pendingSinceMs,
    };
    return result.classification;
  }

  interface DemandingZone {
    zoneId: string;
    desiredPosition: number;
    floorPosition: number;
    flowRateLps: number;
    priorityRank: number;
    bucket: ContentionBucket;
    minVentPosition: number;
    maxVentPosition: number;
  }
  const demanding: DemandingZone[] = [];
  const nonDemandingSmartVent: Record<string, number> = {};

  // Comfort classification for a zone with nothing to position — a
  // no_vent/manual_fixed_vent zone has no Step 1-3 math to run (there's no
  // vent to command), but its tolerance/satisfied-demanding classification
  // still applies "iff sensored", independent of vent hardware type (see
  // the Zone Hardware & Sensor Type Matrix) — it's what driving-zone
  // eligibility (gated on hasTemperatureSensor alone, not vent type — see
  // control/tick.ts's candidate filter) and the dashboard's own reading
  // display depend on. Mirrors the smart-vent path's own
  // inactive/stale/classifyZone precedence exactly, just without the
  // position math that follows it there.
  function classifyNonPositionZone(
    zone: PipelineZoneInput,
  ): ZoneClassification | "inactive" {
    if (zone.resolvedSetpoint === null) return "inactive";
    if (zone.staleReading) return "unclassified_no_sensor";
    const raw = classifyZone({
      hasTemperatureSensor: zone.hasTemperatureSensor,
      state: callActive
        ? (params.state as "COOLING_CALL" | "HEATING_CALL")
        : "COOLING_CALL", // arbitrary while idle; classification is diagnostic only
      calibratedTemp: zone.calibratedTemp,
      resolvedSetpoint: zone.resolvedSetpoint,
      tolerance: zone.tolerance,
      previousClassification: zone.previousClassification,
    });
    return classifyWithStabilization(zone, raw);
  }

  for (const zone of params.zones) {
    if (zone.ventHardwareType === "no_vent") {
      classifications[zone.zoneId] = classifyNonPositionZone(zone);
      continue;
    }
    if (zone.ventHardwareType === "manual_fixed_vent") {
      classifications[zone.zoneId] = classifyNonPositionZone(zone);
      // A single "position" here is purely informational (feeds
      // desired_position_pct/post_contention_position_pct in the tick
      // decision record) — the real, individually-meaningful positions
      // live in zone.manualVents and are what the UI actually displays.
      // Flow-weighted so it stays consistent with how the pressure
      // aggregate below actually contributes for this zone, rather than
      // a plain average that could disagree with it.
      commandedPositions[zone.zoneId] = weightedManualVentPosition(
        zone.manualVents,
      );
      continue;
    }

    // flair_smart_vent from here on.
    if (zone.manualPositionPct !== null) {
      commandedPositions[zone.zoneId] = clampToZoneRange(
        zone.manualPositionPct,
        zone.minVentPosition,
        zone.maxVentPosition,
      );
      continue;
    }

    if (zone.resolvedSetpoint === null) {
      // "inactive" — rests at idle baseline, still counts toward pressure.
      classifications[zone.zoneId] = "inactive";
      nonDemandingSmartVent[zone.zoneId] = clampToZoneRange(
        zone.idleBaselinePosition,
        zone.minVentPosition,
        zone.maxVentPosition,
      );
      continue;
    }

    if (zone.staleReading) {
      classifications[zone.zoneId] = "unclassified_no_sensor";
      nonDemandingSmartVent[zone.zoneId] = effectiveIdleBaseline({
        idleBaselinePosition: zone.idleBaselinePosition,
        minVentPosition: zone.minVentPosition,
        maxVentPosition: zone.maxVentPosition,
        occupied: zone.occupied,
        staleOccupancy: zone.staleOccupancy,
        callActive,
        unoccupiedIdleFactor: params.settings.unoccupiedIdleFactor,
      });
      continue;
    }

    // FAN_ONLY is the one state genuinely unrelated to deviation — the
    // blower circulates *unconditioned* air, so proportional-to-deviation
    // math has nothing meaningful to react to. Every zone (sensored or
    // not) rests at its occupancy-scaled idle baseline, same as ever.
    if (!callActive && params.state === "FAN_ONLY") {
      const rawFanOnly = classifyZone({
        hasTemperatureSensor: zone.hasTemperatureSensor,
        state: ARBITRARY_IDLE_CALL_STATE, // classification is diagnostic only during FAN_ONLY
        calibratedTemp: zone.calibratedTemp,
        resolvedSetpoint: zone.resolvedSetpoint,
        tolerance: zone.tolerance,
        previousClassification: zone.previousClassification,
      });
      classifications[zone.zoneId] = classifyWithStabilization(
        zone,
        rawFanOnly,
      );
      nonDemandingSmartVent[zone.zoneId] = effectiveIdleBaseline({
        idleBaselinePosition: zone.idleBaselinePosition,
        minVentPosition: zone.minVentPosition,
        maxVentPosition: zone.maxVentPosition,
        occupied: zone.occupied,
        staleOccupancy: zone.staleOccupancy,
        callActive: false,
        unoccupiedIdleFactor: params.settings.unoccupiedIdleFactor,
      });
      continue;
    }

    // COOLING_CALL, HEATING_CALL, and now IDLE all reach here. IDLE uses
    // the same arbitrary cooling-direction default the classification
    // label already used (see ARBITRARY_IDLE_CALL_STATE) — extended now to
    // govern *position* too, not just the label. This is a real, confirmed
    // fix: nothing physically changes the instant a call ends (no air is
    // moving either way), so there's no reason a satisfied zone should get
    // shoved back open to idle_baseline_position just because the
    // compressor happened to cycle off — confirmed live, a short-cycling
    // system was yanking a closing bedroom back to 100% every time it hit
    // IDLE, then having to re-close from scratch next cycle, which is
    // exactly the oscillation this replaces with smooth, uninterrupted
    // closing (or opening) straight through an idle gap.
    const effectiveState = callActive
      ? (params.state as "COOLING_CALL" | "HEATING_CALL")
      : ARBITRARY_IDLE_CALL_STATE;

    const rawClassification = classifyZone({
      hasTemperatureSensor: zone.hasTemperatureSensor,
      state: effectiveState,
      calibratedTemp: zone.calibratedTemp,
      resolvedSetpoint: zone.resolvedSetpoint,
      tolerance: zone.tolerance,
      previousClassification: zone.previousClassification,
    });
    const classification = classifyWithStabilization(zone, rawClassification);
    classifications[zone.zoneId] = classification;

    // No sensor means no reliable deviation to close proportionally from —
    // rest at the plain (occupancy-scaled) idle baseline, same as ever.
    // "demanding" and "satisfied" both have a real sensor reading behind
    // them and go through computeDesiredPosition below instead, which
    // handles both directions of the same proportional curve.
    if (classification === "unclassified_no_sensor") {
      nonDemandingSmartVent[zone.zoneId] = effectiveIdleBaseline({
        idleBaselinePosition: zone.idleBaselinePosition,
        minVentPosition: zone.minVentPosition,
        maxVentPosition: zone.maxVentPosition,
        occupied: zone.occupied,
        staleOccupancy: zone.staleOccupancy,
        callActive,
        unoccupiedIdleFactor: params.settings.unoccupiedIdleFactor,
      });
      continue;
    }

    const isDemanding = classification === "demanding";
    const step1 = computeDesiredPosition({
      idleBaselinePosition: zone.idleBaselinePosition,
      minVentPosition: zone.minVentPosition,
      maxVentPosition: zone.maxVentPosition,
      thermalLoadFlags: zone.thermalLoadFlags,
      demanding: isDemanding,
      state: effectiveState,
      calibratedTemp: zone.calibratedTemp,
      resolvedSetpoint: zone.resolvedSetpoint,
      tolerance: zone.tolerance,
      occupied: zone.occupied,
      spiking: zone.spiking,
      settings: {
        proportionalBandWidthC: params.settings.proportionalBandWidthC,
        maxPositionPct: params.settings.maxPositionPct,
        modifierBoosts: params.settings.modifierBoosts,
        heatingChokePositionPct: params.settings.heatingChokePositionPct,
      },
    });

    // Sleep-mode quiet anchor: a satisfied zone in an active Sleep Mode
    // window holds flat at the position that last actually achieved
    // comfort instead of re-running the overshoot ramp above every tick —
    // see sleep_quiet_anchor_enabled's own comment (systemSettings.ts) for
    // the real, confirmed overnight noise problem this fixes. Re-anchors
    // on a demanding->satisfied transition, or once
    // reanchorIntervalMinutes has elapsed since the current anchor was
    // captured — either way, always from *this tick's own* step1 output,
    // never a stale carried-forward ramp calculation. Demanding is
    // completely unaffected regardless of sleep mode, by design: it's the
    // safety net for a night the AC genuinely can't keep up.
    let effectiveDesiredPosition = step1.desiredPosition;
    let anchorPositionPct = zone.priorAnchorPositionPct;
    let anchorSinceMs = zone.priorAnchorSinceMs;
    if (
      params.settings.sleepQuietAnchorEnabled &&
      !isDemanding &&
      zone.sleepModeActive
    ) {
      const reanchorDue =
        anchorPositionPct === null ||
        anchorSinceMs === null ||
        params.nowMs - anchorSinceMs >=
          params.settings.reanchorIntervalMinutes * 60000;
      if (reanchorDue) {
        anchorPositionPct = step1.desiredPosition;
        anchorSinceMs = params.nowMs;
      }
      // reanchorDue's own condition guarantees anchorPositionPct is
      // non-null by this point (either it already was, or the block above
      // just set it) — the `?? step1.desiredPosition` is a type-safe
      // fallback that should never actually trigger.
      effectiveDesiredPosition = anchorPositionPct ?? step1.desiredPosition;
    } else {
      anchorPositionPct = null;
      anchorSinceMs = null;

      // Capacity sharing: a comfortable zone gives up its own unclaimed
      // headroom — down to its own configured floor, full authority, not
      // a capped fraction — to help a sibling that's been commanded near
      // its ceiling with no measurable improvement. See
      // capacity_sharing_enabled's own comment in systemSettings.ts for
      // the real, confirmed 190%+-all-day oversubscription this responds
      // to. sleepModeActive is checked here directly, not just inferred
      // from this `else` branch — an active Sleep Mode window is exempt
      // unconditionally, even if sleep_quiet_anchor_enabled itself is off
      // (which would otherwise fall through to here): quiet hours for a
      // sleeping room aren't up for negotiation just because a daytime
      // zone elsewhere is struggling.
      if (
        params.settings.capacitySharingEnabled &&
        !isDemanding &&
        !zone.sleepModeActive &&
        zone.otherZoneStruggling &&
        !zone.capacitySharingExempt
      ) {
        effectiveDesiredPosition = zone.minVentPosition;
      }
    }
    sleepQuietAnchors[zone.zoneId] = {
      positionPct: anchorPositionPct,
      sinceMs: anchorSinceMs,
    };

    // A satisfied zone closes proportionally toward its floor (see
    // computeDesiredPosition's own comment) but isn't competing for scarce
    // airflow — it bypasses Step 3 contention entirely, same as every
    // other non-demanding path, and goes straight to Step 2 ramping. A
    // "demanding" zone while genuinely IDLE isn't competing for anything
    // either — there's no real airflow to ration while nothing is
    // running — so it bypasses contention too, going straight to its own
    // computed position rather than joining the Step 3 pool.
    if (!isDemanding || !callActive) {
      nonDemandingSmartVent[zone.zoneId] = effectiveDesiredPosition;
      continue;
    }

    demanding.push({
      zoneId: zone.zoneId,
      desiredPosition: effectiveDesiredPosition,
      floorPosition: Math.max(zone.idleBaselinePosition, zone.minVentPosition),
      flowRateLps: zone.flowRateLps,
      priorityRank: zone.priorityRank,
      bucket: bucketFor(params.state, zone.occupied, zone.spiking),
      minVentPosition: zone.minVentPosition,
      maxVentPosition: zone.maxVentPosition,
    });
  }

  // Step 3 — contention, only among demanding zones.
  let contention: ContentionResult | null = null;
  let step3Positions: Record<string, number> = {};
  if (demanding.length > 0) {
    const ranked = rankZones(demanding);
    contention = resolveContention(ranked, params.capLps);
    step3Positions = Object.fromEntries(
      demanding.map((z) => [
        z.zoneId,
        contention?.positions[z.zoneId] ?? z.desiredPosition,
      ]),
    );
  }

  // Step 2 — ramp every smart-vent zone (demanding or resting at an idle
  // baseline) toward its Step-3 output; manual-position/no_vent/manual_fixed
  // zones already have a final position and skip ramping entirely.
  const zoneById = new Map(params.zones.map((z) => [z.zoneId, z]));
  for (const [zoneId, position] of [
    ...Object.entries(step3Positions),
    ...Object.entries(nonDemandingSmartVent),
  ]) {
    const zone = zoneById.get(zoneId);
    if (!zone) continue;
    commandedPositions[zoneId] = rampTowardTarget({
      desiredPosition: position,
      lastCommandedTarget: zone.lastCommandedTarget,
      modulationStepPct: params.settings.modulationStepPct,
      maxStepsPerTick: params.settings.maxStepsPerTick,
      minVentPosition: zone.minVentPosition,
      maxVentPosition: zone.maxVentPosition,
    });
  }

  // Final pressure-floor clamp, reopening in the same priority order Step
  // 3 computed, reversed (highest-priority first) — several vents ramping
  // independently can transiently dip the aggregate below the floor even
  // when both endpoints were individually legal.
  const contributing = params.zones.filter(
    (z) => z.ventHardwareType !== "no_vent",
  );
  const currentAggregateLps = contributing.reduce((sum, z) => {
    if (z.degraded) return sum;
    if (z.ventHardwareType === "manual_fixed_vent") {
      return sum + manualVentAggregateLps(z.manualVents);
    }
    const position = commandedPositions[z.zoneId] ?? 0;
    return sum + (position / 100) * z.flowRateLps;
  }, 0);

  // manual_fixed_vent zones contribute to the aggregate above (a real,
  // fixed vent still consumes airflow budget) but are never reopen
  // candidates here — unlike a flair_smart_vent, there's no software
  // dispatch path that could actually act on a "reopen this further"
  // decision for a physical vent someone set by hand.
  const rankedHighestPriorityFirst = [...contributing]
    .filter((z) => z.ventHardwareType === "flair_smart_vent" && !z.degraded)
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .map((z) => ({
      zoneId: z.zoneId,
      position: commandedPositions[z.zoneId] ?? 0,
      maxVentPosition: z.maxVentPosition,
      flowRateLps: z.flowRateLps,
    }));

  const floorResult = clampToPressureFloor(
    rankedHighestPriorityFirst,
    currentAggregateLps,
    params.floorLps,
  );
  for (const [zoneId, position] of Object.entries(floorResult.positions)) {
    commandedPositions[zoneId] = position;
  }

  return {
    commandedPositions,
    classifications,
    classificationPending,
    sleepQuietAnchors,
    contention,
    pressureFloorClamped: floorResult.clamped,
    insufficientFloor: floorResult.insufficient,
  };
}
