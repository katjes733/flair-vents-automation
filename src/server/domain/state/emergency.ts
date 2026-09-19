import type { HvacCallState } from "~/server/domain/types";
import type { ThermalLoadFlag } from "~/shared/schemas/zoneConfig";

export interface DuctReadingZone {
  zoneId: string;
  // Which of the zone's (possibly several) vents this reading came from —
  // optional since the functions below never key on it (a flat array
  // tolerates more than one entry per zoneId just fine); present so the
  // caller can trace an anomaly back to a specific vent. See "Multi-Vent
  // Zones" in the implementation plan.
  ventId?: string;
  hasSmartVent: boolean;
  ductTemperatureC: number | null;
  ductReadingStale: boolean;
  roomTemperatureC: number;
  // Whether this zone's OWN room-temperature reading (not the duct side)
  // has gone stale — the duct side has always had this check
  // (ductReadingStale); the room side never did, despite being just as
  // vulnerable to Flair/HomeKit's own multi-minute reporting cadence and
  // despite being a genuine, confirmed live incident: a zone's room
  // reading observed frozen for 13-20 minutes straight, straddling the
  // duct-vs-room comparison across what were really two different physical
  // moments (one mid-cooling, one from well before). See "Emergency
  // fail-safe" and isRoomReadingStale's own comment in tick.ts.
  roomReadingStale: boolean;
  demanding: boolean;
  commandedPositionPct: number;
  // A zone flagged distant_high_duct_loss/high_internal_heat_load has a
  // structurally smaller true duct-to-room differential even under a fully
  // healthy call — see equipment_fault_thermal_load_leniency_c's own
  // comment in systemSettings.ts for the real, confirmed false-positive
  // this fixes (Martin Office: both flags set, 4 of 5 recent fail-safe
  // triggers).
  thermalLoadFlags: readonly ThermalLoadFlag[];
  // Whether this vent has sat at/above the open floor continuously for at
  // least equipment_fault_vent_open_dwell_minutes — see that setting's own
  // comment for the real, confirmed false-positive this fixes (a vent that
  // just crossed the floor, or is actively closing through it, hasn't had
  // time for its duct segment to reach a representative reading yet).
  ventOpenDwellSatisfied: boolean;
}

export interface DuctDeltaReading {
  zoneId: string;
  ventId?: string;
  // Normalized so "passing" always means deltaC >= the threshold,
  // regardless of call direction — see normalizedDelta().
  deltaC: number;
}

export interface EquipmentFaultResult {
  faulted: boolean;
  reason: string;
  // The real, measured (normalized) differential for every usable vent —
  // added so a real trigger can be logged with the actual reading instead
  // of the configured threshold constant. Empty when there's no usable
  // duct data (the "dormant" case).
  ductDeltasC: DuctDeltaReading[];
}

function normalizedDelta(zone: DuctReadingZone, state: HvacCallState): number {
  const raw = zone.roomTemperatureC - (zone.ductTemperatureC as number);
  return state === "COOLING_CALL" ? raw : -raw;
}

// A zone carrying any thermal load flag gets a reduced threshold — see
// DuctReadingZone.thermalLoadFlags's own comment for why.
function effectiveThresholdC(
  zone: DuctReadingZone,
  baseThresholdC: number,
  thermalLoadLeniencyC: number,
): number {
  return zone.thermalLoadFlags.length > 0
    ? baseThresholdC - thermalLoadLeniencyC
    : baseThresholdC;
}

function passesDifferential(
  zone: DuctReadingZone,
  state: HvacCallState,
  thresholdC: number,
): boolean {
  return normalizedDelta(zone, state) >= thresholdC;
}

// A vent sitting below this position has too little real airflow through
// its own duct segment for its duct temperature to mean anything — the
// reading drifts toward room-ambient rather than reflecting what the
// compressor is actually producing. Excluded from "usable" the same way a
// stale or missing reading already is — see minVentOpenPct's own comment
// in systemSettings.ts for the real, confirmed false-positive this fixes.
// A vent that clears that floor only just now, or is passing through it
// while actively closing, is excluded too until it's sat there long enough
// (ventOpenDwellSatisfied) — see equipment_fault_vent_open_dwell_minutes's
// own comment for the real, confirmed false-positive this fixes.
function usableZones(
  zones: DuctReadingZone[],
  minVentOpenPct: number,
): DuctReadingZone[] {
  return zones.filter(
    (z) =>
      z.hasSmartVent &&
      !z.ductReadingStale &&
      !z.roomReadingStale &&
      z.ductTemperatureC !== null &&
      z.commandedPositionPct >= minVentOpenPct &&
      z.ventOpenDwellSatisfied,
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
  thermalLoadLeniencyC: number;
  minVentOpenPct: number;
  zones: DuctReadingZone[];
}): EquipmentFaultResult {
  if (params.callDurationMinutes < params.gracePeriodMinutes) {
    return {
      faulted: false,
      reason: "within the equipment startup grace period",
      ductDeltasC: [],
    };
  }
  const usable = usableZones(params.zones, params.minVentOpenPct);
  if (usable.length === 0) {
    return {
      faulted: false,
      reason: "no usable duct data on this handler — dormant",
      ductDeltasC: [],
    };
  }
  const ductDeltasC: DuctDeltaReading[] = usable.map((z) => ({
    zoneId: z.zoneId,
    ventId: z.ventId,
    deltaC: normalizedDelta(z, params.state),
  }));
  const anyPassing = usable.some((z) =>
    passesDifferential(
      z,
      params.state,
      effectiveThresholdC(
        z,
        params.ductDeltaThresholdC,
        params.thermalLoadLeniencyC,
      ),
    ),
  );
  return anyPassing
    ? {
        faulted: false,
        reason: "at least one vent shows the expected duct differential",
        ductDeltasC,
      }
    : {
        faulted: true,
        reason: "no vent on this handler shows the expected duct differential",
        ductDeltasC,
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
  ventId?: string;
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
  thermalLoadLeniencyC: number;
  minVentOpenPct: number;
  zones: DuctReadingZone[];
}): DuctAnomalyResult[] {
  const usable = usableZones(params.zones, params.minVentOpenPct);
  const passing = usable.filter((z) =>
    passesDifferential(
      z,
      params.state,
      effectiveThresholdC(
        z,
        params.ductDeltaThresholdC,
        params.thermalLoadLeniencyC,
      ),
    ),
  );
  const failing = usable.filter(
    (z) =>
      !passesDifferential(
        z,
        params.state,
        effectiveThresholdC(
          z,
          params.ductDeltaThresholdC,
          params.thermalLoadLeniencyC,
        ),
      ),
  );
  if (passing.length === 0) {
    // Every usable vent fails — detectEquipmentFault's case, not an
    // isolated anomaly.
    return failing.map((z) => ({
      zoneId: z.zoneId,
      ventId: z.ventId,
      anomalous: false,
    }));
  }
  return failing.map((z) => ({
    zoneId: z.zoneId,
    ventId: z.ventId,
    anomalous: z.demanding && z.commandedPositionPct > 0,
  }));
}
