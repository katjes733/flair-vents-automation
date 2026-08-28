import type { VentHardwareType } from "~/shared/schemas/zoneConfig";

export interface PressureZoneInput {
  zoneId: string;
  ventHardwareType: VentHardwareType;
  position: number; // commanded position for smart vents, assumed_fixed_position for manual vents
  flowRateLps: number;
  degraded: boolean;
}

export interface PressureAggregate {
  aggregateOpenLps: number;
  aggregateOpenPct: number; // relative to blowerRatedFlowRateLps
  perZoneContributionLps: Record<string, number>;
}

/**
 * Flow-rate-weighted aggregate open airflow. no_vent zones are excluded
 * (no register); degraded vents are fully excluded too — a monitored
 * optimism tradeoff, flagged by a warn-level log at the call site, not
 * here. manual_fixed_vent zones count at their assumed_fixed_position.
 * See "Pressure safeguard".
 */
export function computeAggregate(
  zones: PressureZoneInput[],
  blowerRatedFlowRateLps: number,
): PressureAggregate {
  const contributing = zones.filter(
    (z) => z.ventHardwareType !== "no_vent" && !z.degraded,
  );
  const perZoneContributionLps: Record<string, number> = {};
  let aggregateOpenLps = 0;
  for (const zone of contributing) {
    const contribution = (zone.position / 100) * zone.flowRateLps;
    perZoneContributionLps[zone.zoneId] = contribution;
    aggregateOpenLps += contribution;
  }
  return {
    aggregateOpenLps,
    aggregateOpenPct:
      blowerRatedFlowRateLps > 0
        ? (aggregateOpenLps / blowerRatedFlowRateLps) * 100
        : 0,
    perZoneContributionLps,
  };
}

export interface FloorClampResult {
  positions: Record<string, number>;
  clamped: boolean;
  insufficient: boolean;
}

/**
 * If the aggregate falls below the safety floor, reopens zones in the
 * same priority order Step 3 already computed, reversed (highest-priority
 * first) — see "Pipeline ordering". Respects each zone's own
 * max_vent_position ceiling; if every zone is already at its ceiling and
 * the floor still isn't met, `insufficient` is true rather than a silent
 * bypass of the range.
 */
export function clampToPressureFloor(
  rankedHighestPriorityFirst: Array<{
    zoneId: string;
    position: number;
    maxVentPosition: number;
    flowRateLps: number;
  }>,
  currentAggregateLps: number,
  floorLps: number,
): FloorClampResult {
  if (currentAggregateLps >= floorLps) {
    return { positions: {}, clamped: false, insufficient: false };
  }
  const positions: Record<string, number> = {};
  let aggregate = currentAggregateLps;
  for (const zone of rankedHighestPriorityFirst) {
    if (aggregate >= floorLps) break;
    if (zone.position >= zone.maxVentPosition) continue;
    const deficitLps = floorLps - aggregate;
    const maxOpenableLps =
      ((zone.maxVentPosition - zone.position) / 100) * zone.flowRateLps;
    const openLps = Math.min(deficitLps, maxOpenableLps);
    const openPct =
      zone.flowRateLps > 0 ? (openLps / zone.flowRateLps) * 100 : 0;
    positions[zone.zoneId] = zone.position + openPct;
    aggregate += openLps;
  }
  return {
    positions,
    clamped: Object.keys(positions).length > 0,
    insufficient: aggregate < floorLps,
  };
}
