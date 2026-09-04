import {
  asAbsoluteTemp,
  toDisplayAbsolute,
  type TemperatureUnit,
} from "~/shared/types/temperature";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import type { ManualOverrideRecord } from "~/client/api/overridesApi";
import {
  computeTruePeriods,
  type BooleanPeriod,
  type Sample,
} from "~/client/components/shared/charts/timelineSegments";
import { niceTickInterval } from "~/client/components/shared/charts/chartMath";

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

/**
 * OpenCapacityChart's Y-axis ticks — a real bug found live: a fixed
 * `domain={[0, 100]}` either clips real data or leaves Recharts to
 * auto-extend the domain with an unrounded, raw-float tick label sitting
 * exactly at the data's real max (confirmed live against production data:
 * "157.70078406442045%", since `aggregate_open_pct` is relative to the
 * blower's rated flow, not a hard 100% ceiling, and this deployment's real
 * aggregate genuinely exceeds it). Always computing fresh, evenly-spaced
 * ticks — covering at least 100% so the ordinary case still reads as a
 * clean 0/40/80/100-style scale — fixes both the clipping and the
 * unrounded-label problem at once.
 */
export function computeOpenCapacityYTicks(
  data: OpenCapacityChartRow[],
  capPct: number | null,
): number[] {
  const values = data.flatMap((d) => (d.openPct !== null ? [d.openPct] : []));
  if (capPct !== null) values.push(capPct);
  const max = values.length > 0 ? Math.max(...values, 100) : 100;
  const interval = niceTickInterval(0, max);
  const domainMax = Math.ceil(max / interval) * interval;
  const ticks: number[] = [];
  for (let v = 0; v <= domainMax + 1e-9; v += interval) {
    ticks.push(Math.round(v / interval) * interval);
  }
  return ticks;
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

export interface OverrideSegment {
  startMs: number;
  endMs: number;
  override: ManualOverrideRecord;
}

/**
 * Turns override rows into non-overlapping display segments for the
 * override activity lane — see "Stage 13, Increment B" follow-up. The
 * `manual_overrides` table is append-only and never marks a row as
 * "superseded" when a newer one is created for the same zone (see the Data
 * Model's "last-write-wins" rule) — `resolveManualOverride`'s own "most
 * recent row per zone" selection is what actually makes an older row stop
 * mattering the instant a newer one exists, regardless of the older row's
 * own `expires_at`. Without reproducing that here, two rows whose stored
 * windows technically overlap would render as two simultaneously "active"
 * bars, which never happened in reality — so each row's rendered end is
 * capped at whichever comes first: its own revocation/expiry, or the next
 * row's creation.
 */
export function computeOverrideSegments(
  overrides: ManualOverrideRecord[],
  domainEndMs: number,
): OverrideSegment[] {
  const sorted = [...overrides].sort((a, b) => a.createdAtMs - b.createdAtMs);
  return sorted.map((o, i) => {
    const naturalEnd = o.revokedAtMs ?? o.expiresAtMs ?? domainEndMs;
    const supersededAtMs =
      i + 1 < sorted.length ? sorted[i + 1].createdAtMs : Infinity;
    return {
      startMs: o.createdAtMs,
      endMs: Math.min(naturalEnd, supersededAtMs),
      override: o,
    };
  });
}
