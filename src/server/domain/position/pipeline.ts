import type {
  VentHardwareType,
  ThermalLoadFlag,
} from "~/shared/schemas/zoneConfig";
import type { AbsoluteTemp, TempDelta } from "~/shared/types/temperature";
import type {
  HvacState,
  ModifierBoosts,
  ZoneClassification,
} from "~/server/domain/types";
import { classifyZone } from "~/server/domain/targets/comfortTolerance";
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
  flowRateLps: number;
  assumedFixedPosition: number | null; // manual_fixed_vent only
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
}

export interface PipelineResult {
  commandedPositions: Record<string, number>;
  classifications: Record<string, ZoneClassification | "inactive">;
  contention: ContentionResult | null;
  pressureFloorClamped: boolean;
  insufficientFloor: boolean;
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
  settings: {
    proportionalBandWidthC: TempDelta;
    maxPositionPct: number;
    modifierBoosts: ModifierBoosts;
    heatingChokePositionPct: number;
    unoccupiedIdleFactor: number;
    modulationStepPct: number;
    maxStepsPerTick: number;
  };
  capLps: number;
  floorLps: number;
}): PipelineResult {
  const callActive =
    params.state === "COOLING_CALL" || params.state === "HEATING_CALL";
  const commandedPositions: Record<string, number> = {};
  const classifications: Record<string, ZoneClassification | "inactive"> = {};

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

  for (const zone of params.zones) {
    if (zone.ventHardwareType === "no_vent") {
      continue;
    }
    if (zone.ventHardwareType === "manual_fixed_vent") {
      commandedPositions[zone.zoneId] = zone.assumedFixedPosition ?? 0;
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

    if (!callActive) {
      // IDLE/FAN_ONLY: no Step 1 math (it's only defined for the two call
      // states) — every smart vent rests at its (occupancy-scaled) idle
      // baseline.
      classifications[zone.zoneId] = classifyZone({
        hasTemperatureSensor: zone.hasTemperatureSensor,
        state: "COOLING_CALL", // arbitrary; classification is diagnostic only while idle
        calibratedTemp: zone.calibratedTemp,
        resolvedSetpoint: zone.resolvedSetpoint,
        tolerance: zone.tolerance,
      });
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

    const classification = classifyZone({
      hasTemperatureSensor: zone.hasTemperatureSensor,
      state: params.state as "COOLING_CALL" | "HEATING_CALL",
      calibratedTemp: zone.calibratedTemp,
      resolvedSetpoint: zone.resolvedSetpoint,
      tolerance: zone.tolerance,
    });
    classifications[zone.zoneId] = classification;

    if (classification !== "demanding") {
      nonDemandingSmartVent[zone.zoneId] = effectiveIdleBaseline({
        idleBaselinePosition: zone.idleBaselinePosition,
        minVentPosition: zone.minVentPosition,
        maxVentPosition: zone.maxVentPosition,
        occupied: zone.occupied,
        staleOccupancy: zone.staleOccupancy,
        callActive: true,
        unoccupiedIdleFactor: params.settings.unoccupiedIdleFactor,
      });
      continue;
    }

    const step1 = computeDesiredPosition({
      idleBaselinePosition: zone.idleBaselinePosition,
      minVentPosition: zone.minVentPosition,
      maxVentPosition: zone.maxVentPosition,
      thermalLoadFlags: zone.thermalLoadFlags,
      hasTemperatureSensor: zone.hasTemperatureSensor,
      state: params.state as "COOLING_CALL" | "HEATING_CALL",
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

    demanding.push({
      zoneId: zone.zoneId,
      desiredPosition: step1.desiredPosition,
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
    const position = commandedPositions[z.zoneId] ?? 0;
    return z.degraded ? sum : sum + (position / 100) * z.flowRateLps;
  }, 0);

  const rankedHighestPriorityFirst = [...contributing]
    .filter((z) => !z.degraded)
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
    contention,
    pressureFloorClamped: floorResult.clamped,
    insufficientFloor: floorResult.insufficient,
  };
}
