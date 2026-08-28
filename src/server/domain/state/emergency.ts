import type { HvacCallState } from "~/server/domain/types";

export interface DuctReadingZone {
  zoneId: string;
  hasSmartVent: boolean;
  ductTemperatureC: number | null;
  ductReadingStale: boolean;
  roomTemperatureC: number;
  demanding: boolean;
  commandedPositionPct: number;
}

export interface EquipmentFaultResult {
  faulted: boolean;
  reason: string;
}

function passesDifferential(
  zone: DuctReadingZone,
  state: HvacCallState,
  thresholdC: number,
): boolean {
  const delta = zone.roomTemperatureC - (zone.ductTemperatureC as number);
  return state === "COOLING_CALL" ? delta >= thresholdC : delta <= -thresholdC;
}

function usableZones(zones: DuctReadingZone[]): DuctReadingZone[] {
  return zones.filter(
    (z) => z.hasSmartVent && !z.ductReadingStale && z.ductTemperatureC !== null,
  );
}

/**
 * Derives an equipment-fault signal from per-vent duct temperature — Flair
 * exposes no direct fault field (Phase 0 discovery), so this is the
 * derived substitute. A fault is concluded only once the call has run past
 * a grace period (covers startup lag) AND *none* of the handler's smart
 * vents with fresh duct data show the expected differential — if even one
 * does, the compressor is clearly running, and any other zone's poor
 * airflow is a per-vent concern (`detectDuctAirflowAnomaly`), not a
 * whole-system fault. Dormant (never faults) when there's no usable duct
 * data at all — a known limitation, not a silent false negative. See
 * "Emergency fail-safe".
 */
export function detectEquipmentFault(params: {
  state: HvacCallState;
  callDurationMinutes: number;
  gracePeriodMinutes: number;
  ductDeltaThresholdC: number;
  zones: DuctReadingZone[];
}): EquipmentFaultResult {
  if (params.callDurationMinutes < params.gracePeriodMinutes) {
    return {
      faulted: false,
      reason: "within the equipment startup grace period",
    };
  }
  const usable = usableZones(params.zones);
  if (usable.length === 0) {
    return {
      faulted: false,
      reason: "no usable duct data on this handler — dormant",
    };
  }
  const anyPassing = usable.some((z) =>
    passesDifferential(z, params.state, params.ductDeltaThresholdC),
  );
  return anyPassing
    ? {
        faulted: false,
        reason: "at least one vent shows the expected duct differential",
      }
    : {
        faulted: true,
        reason: "no vent on this handler shows the expected duct differential",
      };
}

/** Forced 100% for every smart vent — bypasses ramp/step-delta/range/manual override entirely. */
export function buildFailSafeCommands(
  zoneIds: string[],
): Record<string, number> {
  return Object.fromEntries(zoneIds.map((id) => [id, 100]));
}

export interface DuctAnomalyResult {
  zoneId: string;
  anomalous: boolean;
}

/**
 * Isolated per-zone duct-airflow anomaly: this vent fails the same
 * duct-differential check while at least one sibling passes — a blocked or
 * disconnected duct run for that specific zone, not an equipment problem.
 * Mutually exclusive with `detectEquipmentFault` by construction (that's
 * "every vent fails"; this is "this vent fails, a sibling doesn't"). Only
 * flagged for a zone that's currently demanding and commanded meaningfully
 * open — a zone resting at idle baseline failing the check isn't evidence
 * of anything. Alert-only, never a position change.
 */
export function detectDuctAirflowAnomaly(params: {
  state: HvacCallState;
  ductDeltaThresholdC: number;
  zones: DuctReadingZone[];
}): DuctAnomalyResult[] {
  const usable = usableZones(params.zones);
  const passing = usable.filter((z) =>
    passesDifferential(z, params.state, params.ductDeltaThresholdC),
  );
  const failing = usable.filter(
    (z) => !passesDifferential(z, params.state, params.ductDeltaThresholdC),
  );
  if (passing.length === 0) {
    // Every usable vent fails — detectEquipmentFault's case, not an
    // isolated anomaly.
    return failing.map((z) => ({ zoneId: z.zoneId, anomalous: false }));
  }
  return failing.map((z) => ({
    zoneId: z.zoneId,
    anomalous: z.demanding && z.commandedPositionPct > 0,
  }));
}
