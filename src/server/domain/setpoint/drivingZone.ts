export interface DrivingZoneCandidate {
  zoneId: string;
  hasTemperatureSensor: boolean;
  stale: boolean;
  demanding: boolean;
  deviation: number; // raw calibrated deviation — never the boosted Step 1 value
  priorityRank: number;
  occupied: boolean;
}

export type DrivingZoneSelectionReason =
  | "dynamic_worst_off"
  | "explicit_override"
  | "override_ineligible_fallback"
  | "none_eligible";

export interface DrivingZoneSelection {
  zoneId: string | null;
  reason: DrivingZoneSelectionReason;
}

function isEligible(z: DrivingZoneCandidate): boolean {
  return z.hasTemperatureSensor && !z.stale && z.demanding;
}

function selectDynamic(params: {
  candidates: DrivingZoneCandidate[];
  currentlyTracked: string | null;
  ticksSinceLeadChanged: number;
  switchMarginC: number;
  switchDwellTicks: number;
}): string | null {
  const eligible = params.candidates.filter(isEligible);
  if (eligible.length === 0) return null;

  const worstOff = eligible.reduce((best, c) => {
    if (c.deviation > best.deviation) return c;
    if (c.deviation < best.deviation) return best;
    if (c.priorityRank < best.priorityRank) return c;
    if (c.priorityRank > best.priorityRank) return best;
    return c.occupied && !best.occupied ? c : best;
  });

  const current = params.currentlyTracked
    ? eligible.find((c) => c.zoneId === params.currentlyTracked)
    : undefined;
  if (!current) return worstOff.zoneId;
  if (worstOff.zoneId === current.zoneId) return current.zoneId;

  const gap = worstOff.deviation - current.deviation;
  if (
    gap > params.switchMarginC &&
    params.ticksSinceLeadChanged >= params.switchDwellTicks
  ) {
    return worstOff.zoneId;
  }
  return current.zoneId;
}

/**
 * Every tick, tracks whichever eligible zone currently has the largest raw
 * deviation — recomputed each tick, not a fixed pick for the whole call —
 * unless an explicit, eligible override pins a specific zone. Hysteresis
 * (margin + dwell, mirroring spike detection) prevents two nearly-tied
 * zones from flipping the tracked zone every tick. See "Driving setpoint
 * selection & the Ecobee/Bosch mechanism".
 */
export function selectDrivingZone(params: {
  candidates: DrivingZoneCandidate[];
  explicitOverrideZoneId: string | null;
  currentlyTracked: string | null;
  ticksSinceLeadChanged: number;
  switchMarginC: number;
  switchDwellTicks: number;
}): DrivingZoneSelection {
  if (params.explicitOverrideZoneId) {
    const overridden = params.candidates.find(
      (c) => c.zoneId === params.explicitOverrideZoneId,
    );
    if (overridden && isEligible(overridden)) {
      return { zoneId: overridden.zoneId, reason: "explicit_override" };
    }
    const dynamic = selectDynamic(params);
    return dynamic
      ? { zoneId: dynamic, reason: "override_ineligible_fallback" }
      : { zoneId: null, reason: "none_eligible" };
  }
  const dynamic = selectDynamic(params);
  return dynamic
    ? { zoneId: dynamic, reason: "dynamic_worst_off" }
    : { zoneId: null, reason: "none_eligible" };
}
