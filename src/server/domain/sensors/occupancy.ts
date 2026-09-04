import { clampToZoneRange } from "~/server/domain/position/clamp";

export interface OccupancyHysteresisState {
  occupied: boolean;
  pendingFlipSince: number | null;
}

/**
 * Debounced occupancy — a stabilization dwell before flipping states,
 * mirroring spike detection's hysteresis pattern, applied as cheap
 * insurance regardless of whether Flair's own raw signal turns out to
 * already be debounced (unconfirmed as of Phase 0). Suppressed (holds the
 * previous state) whenever the reading is stale — reusing the Stale
 * Sensor Reading Safeguard rather than a second staleness mechanism, for
 * the same underlying reason: a stuck `occupied: true` would hand a zone
 * permanent priority it hasn't earned. An unsensored zone is never
 * occupied. See "Occupancy".
 */
export function evaluateOccupancy(params: {
  hasOccupancySensor: boolean;
  rawOccupied: boolean | null;
  stale: boolean;
  previous: OccupancyHysteresisState;
  nowMs: number;
  stabilizationMinutes: number;
}): OccupancyHysteresisState {
  if (!params.hasOccupancySensor) {
    return { occupied: false, pendingFlipSince: null };
  }
  if (params.stale || params.rawOccupied === null) {
    return params.previous;
  }
  if (params.rawOccupied === params.previous.occupied) {
    return { occupied: params.previous.occupied, pendingFlipSince: null };
  }
  const pendingSince = params.previous.pendingFlipSince ?? params.nowMs;
  const dwellElapsedMinutes = (params.nowMs - pendingSince) / 60000;
  if (dwellElapsedMinutes >= params.stabilizationMinutes) {
    return { occupied: params.rawOccupied, pendingFlipSince: null };
  }
  return { occupied: params.previous.occupied, pendingFlipSince: pendingSince };
}

/**
 * The occupancy-scaled idle baseline for a zone with no real deviation to
 * react to — either genuinely resting (FAN_ONLY/IDLE, no call active at
 * all) or sensorless (has_temperature_sensor false, so there's no
 * deviation to compute a proportional close from even during a real
 * call). A *sensored* zone that's actually "satisfied" during an active
 * call no longer goes through this function at all — see
 * `step1DesiredPosition.ts`'s own not-demanding branch, which closes it
 * proportionally toward its floor as it gets further past comfortable,
 * regardless of occupancy, rather than resting flat here.
 *
 * During an active call: unoccupied closes all the way to
 * min_vent_position (no reason to hold a sensorless, empty room open while
 * the equipment works); occupied stays at the plain idle_baseline_position
 * (no data at all to react to, so err toward not cutting off airflow to an
 * occupied room). During FAN_ONLY/IDLE, the gentler unoccupiedIdleFactor
 * reduction applies instead of a full close (circulation fairness, not
 * scarcity — nothing is actively running either way). Stale occupancy
 * falls back to the plain, unscaled baseline in both cases — the safe
 * direction to err when occupancy might be wrong.
 */
export function effectiveIdleBaseline(params: {
  idleBaselinePosition: number;
  minVentPosition: number;
  maxVentPosition: number;
  occupied: boolean;
  staleOccupancy: boolean;
  callActive: boolean;
  unoccupiedIdleFactor: number;
}): number {
  const raw =
    params.occupied || params.staleOccupancy
      ? params.idleBaselinePosition
      : params.callActive
        ? params.minVentPosition
        : params.idleBaselinePosition * params.unoccupiedIdleFactor;
  return clampToZoneRange(raw, params.minVentPosition, params.maxVentPosition);
}
