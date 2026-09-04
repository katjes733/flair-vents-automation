import {
  asAbsoluteTemp,
  toDisplayAbsolute,
  type TemperatureUnit,
} from "~/shared/types/temperature";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import {
  computeTruePeriods,
  type BooleanPeriod,
  type Sample,
} from "~/client/components/shared/charts/timelineSegments";

/**
 * Every pure data-transformation this app's Increment-B telemetry views
 * need, kept separate from the Recharts-rendering components themselves —
 * see "Stage 13, Increment B" in the implementation plan. Recharts
 * components aren't unit-tested here, matching tesla-powerwall-automation's
 * own established convention (neither of its own chart components has a
 * test file — jsdom's lack of real layout/ResizeObserver support makes
 * asserting on rendered chart output low-value); this module is what keeps
 * the actual logic — which is the part that can be silently wrong —
 * covered regardless.
 */

export interface TemperatureChartRow {
  time: number;
  temp: number | null;
  setpoint: number | null;
}

export function buildZoneTemperatureData(
  points: TickHistoryPoint[],
  zoneId: string,
  unit: TemperatureUnit,
): TemperatureChartRow[] {
  return points.map((p) => {
    const zone = p.decision.zones.find((z) => z.zone_id === zoneId);
    return {
      time: p.loggedAtMs,
      temp:
        zone?.temp_calibrated != null
          ? toDisplayAbsolute(asAbsoluteTemp(zone.temp_calibrated), unit)
          : null,
      setpoint:
        zone?.resolved_setpoint != null
          ? toDisplayAbsolute(asAbsoluteTemp(zone.resolved_setpoint), unit)
          : null,
    };
  });
}

export interface VentPositionChartRow {
  time: number;
  commanded: number | null;
  reported: number | null;
  degraded: boolean;
}

export function buildVentPositionData(
  points: TickHistoryPoint[],
  zoneId: string,
  flairVentId: string,
): VentPositionChartRow[] {
  return points.map((p) => {
    const zone = p.decision.zones.find((z) => z.zone_id === zoneId);
    const vent = zone?.vents.find((v) => v.flair_vent_id === flairVentId);
    return {
      time: p.loggedAtMs,
      commanded: vent?.commanded_position_pct ?? null,
      reported: vent?.reported_position_pct ?? null,
      degraded: vent?.degraded ?? false,
    };
  });
}

export interface OpenCapacityChartRow {
  time: number;
  openPct: number | null;
  capPct: number | null;
}

export function buildOpenCapacityData(
  points: TickHistoryPoint[],
): OpenCapacityChartRow[] {
  return points.map((p) => ({
    time: p.loggedAtMs,
    openPct: p.decision.pressure?.aggregate_open_pct ?? null,
    capPct: p.decision.pressure?.cap_pct ?? null,
  }));
}

export interface AgreementMetricResult {
  meanAbsoluteDeltaPct: number | null;
  sampleCount: number;
}

/**
 * The rolling shadow-mode agreement metric named in "Shadow mode (dry
 * run)" — mean absolute delta between commanded and reported position,
 * across every vent sample in the window, on every air handler/zone this
 * window's points cover. Null when there's nothing to average (no points,
 * or every sample missing one side of the pair).
 */
export function computeAgreementMetric(
  points: TickHistoryPoint[],
): AgreementMetricResult {
  let sum = 0;
  let count = 0;
  for (const p of points) {
    for (const zone of p.decision.zones) {
      for (const vent of zone.vents) {
        if (
          vent.commanded_position_pct != null &&
          vent.reported_position_pct != null
        ) {
          sum += Math.abs(
            vent.commanded_position_pct - vent.reported_position_pct,
          );
          count += 1;
        }
      }
    }
  }
  return {
    meanAbsoluteDeltaPct: count > 0 ? sum / count : null,
    sampleCount: count,
  };
}

function ventDegradedSamples(
  points: TickHistoryPoint[],
  zoneId: string,
  flairVentId: string,
): Sample<boolean>[] {
  return points.map((p) => {
    const zone = p.decision.zones.find((z) => z.zone_id === zoneId);
    const vent = zone?.vents.find((v) => v.flair_vent_id === flairVentId);
    return { timeMs: p.loggedAtMs, value: vent?.degraded ?? false };
  });
}

/** The historical half of DegradedVentHistory — see that component. */
export function computeDegradedPeriodsForVent(
  points: TickHistoryPoint[],
  zoneId: string,
  flairVentId: string,
  domainEndMs: number,
): BooleanPeriod[] {
  return computeTruePeriods(
    ventDegradedSamples(points, zoneId, flairVentId),
    domainEndMs,
  );
}

/** The historical half of EquipmentFaultLog — see that component. */
export function computeFaultPeriodsForAirHandler(
  points: TickHistoryPoint[],
  domainEndMs: number,
): BooleanPeriod[] {
  const samples = points.map((p) => ({
    timeMs: p.loggedAtMs,
    value: p.decision.equipment_fault_active,
  }));
  return computeTruePeriods(samples, domainEndMs);
}

/**
 * A vent's own Flair-app nickname as of the most recent point that saw it —
 * mirrors the "prefer the real nickname over the opaque id" rule already
 * applied live (see "Raw IDs Leaking Into the UI"). Null when the vent
 * never appeared in this window's points or was never named in Flair.
 */
export function findLatestVentName(
  points: TickHistoryPoint[],
  zoneId: string,
  flairVentId: string,
): string | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const zone = points[i].decision.zones.find((z) => z.zone_id === zoneId);
    const vent = zone?.vents.find((v) => v.flair_vent_id === flairVentId);
    if (vent?.name) return vent.name;
  }
  return null;
}
