import type { VentHardwareType } from "~/shared/schemas/zoneConfig";

export interface PressureZoneInput {
  zoneId: string;
  ventHardwareType: VentHardwareType;
  position: number; // commanded position for smart vents; ignored for manual_fixed_vent when manualVents is given
  flowRateLps: number;
  degraded: boolean;
  // manual_fixed_vent only — each vent's own position and resolved duct
  // rating. When given (non-empty), the aggregate sums each vent's own
  // contribution instead of using position/flowRateLps directly, since a
  // manual zone's vents can each sit at a genuinely different position.
  // See "Multi-Vent Manual Zones".
  manualVents?: Array<{ position: number; flowRateLps: number }>;
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
 * here. manual_fixed_vent zones count at each of their own vents' fixed
 * position (see manualVents on PressureZoneInput). See "Pressure safeguard".
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
    const contribution =
      zone.ventHardwareType === "manual_fixed_vent" && zone.manualVents
        ? zone.manualVents.reduce(
            (sum, v) => sum + (v.position / 100) * v.flowRateLps,
            0,
          )
        : (zone.position / 100) * zone.flowRateLps;
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
  // discrete_position_step_pct's own effective grid (systemSettings.ts),
  // or null when that setting isn't opted into. Deliberately NOT
  // modulation_step_pct's plain value in the unset case — a tiny,
  // functionally-negligible reopen (a fraction of a percent, easily
  // produced when the floor is only barely unmet) is harmless as an
  // unquantized float, but forcing it onto even a fine 10% grid would
  // turn a dust-sized nudge into a disruptive full-step jump for no
  // benefit; confirmed live via a real test regression this exact change
  // caused before being scoped down to bucketing-only. Once bucketing is
  // active, though, an off-grid float here would violate the whole point
  // of the feature (every commit position is a "trusted" bucket value),
  // so quantization is mandatory in that case — always rounding UP, never
  // to nearest, since rounding down could leave the aggregate still short
  // of the very floor this function exists to satisfy.
  quantizeStepPct: number | null,
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
    const rawTarget = zone.position + openPct;
    const finalTarget =
      quantizeStepPct === null
        ? rawTarget
        : Math.min(
            Math.ceil(rawTarget / quantizeStepPct) * quantizeStepPct,
            zone.maxVentPosition,
          );
    positions[zone.zoneId] = finalTarget;
    // The aggregate has to reflect what was actually committed above, not
    // the pre-quantization estimate, or a later zone in this same loop
    // could be under- or over-opened relative to the real result.
    const actualOpenPct = finalTarget - zone.position;
    aggregate += (actualOpenPct / 100) * zone.flowRateLps;
  }
  return {
    positions,
    clamped: Object.keys(positions).length > 0,
    insufficient: aggregate < floorLps,
  };
}
