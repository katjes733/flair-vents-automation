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
 * The occupancy-scaled idle baseline fix (see "Occupancy-scaled idle
 * baseline" in the plan): during an active call, a satisfied-and-
 * unoccupied zone closes all the way to its own min_vent_position floor,
 * not a scaled fraction — there's no reason to hold a room open once it's
 * both comfortable and empty while the equipment is actively working.
 * During FAN_ONLY/IDLE, the gentler unoccupiedIdleFactor reduction applies
 * instead (circulation fairness, not scarcity). Stale occupancy falls back
 * to the plain, unscaled baseline in both cases — the safe direction to
 * err when occupancy might be wrong.
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
