import { describe, it, expect } from "vitest";
import {
  buildZoneTemperatureData,
  buildVentPositionData,
  buildOpenCapacityData,
  computeAgreementMetric,
  computeDegradedPeriodsForVent,
  computeFaultPeriodsForAirHandler,
  findLatestVentName,
} from "~/client/components/telemetry/chartData";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import type {
  AirHandlerTickDecision,
  VentTickDecisionRecord,
  ZoneTickDecisionRecord,
} from "~/client/api/airHandlersApi";

function makeVent(
  overrides: Partial<VentTickDecisionRecord> = {},
): VentTickDecisionRecord {
  return {
    flair_vent_id: "vent-1",
    name: "",
    commanded_position_pct: null,
    reported_position_pct: null,
    dispatch_decision: "dispatched",
    degraded: false,
    voltage: null,
    current_rssi: null,
    ...overrides,
  };
}

function makeZone(
  overrides: Partial<ZoneTickDecisionRecord> = {},
): ZoneTickDecisionRecord {
  return {
    zone_id: "z1",
    name: "Zone 1",
    vent_hardware_type: "flair_smart_vent",
    classification: "demanding",
    occupied: false,
    spiking: false,
    temp_calibrated: null,
    resolved_setpoint: null,
    desired_position_pct: null,
    post_contention_position_pct: null,
    vents: [],
    reason: "",
    ...overrides,
  };
}

function makePoint(
  loggedAtMs: number,
  overrides: Partial<AirHandlerTickDecision> = {},
): TickHistoryPoint {
  return {
    loggedAtMs,
    decision: {
      air_handler_id: "ah-1",
      tick_at: new Date(loggedAtMs).toISOString(),
      duration_ms: 1,
      dry_run: false,
      control_disarmed: false,
      equipment_fault_active: false,
      hvac_state: "IDLE",
      call_confidence: "reported",
      zones: [],
      contention: null,
      pressure: null,
      driving_zone: null,
      setpoint_push: null,
      narrative: "",
      ...overrides,
    },
  };
}

describe("buildZoneTemperatureData", () => {
  it("converts calibrated temp and setpoint to the display unit", () => {
    const points = [
      makePoint(100, {
        zones: [makeZone({ temp_calibrated: 20, resolved_setpoint: 22 })],
      }),
    ];
    const rows = buildZoneTemperatureData(points, "z1", "F");
    expect(rows).toEqual([{ time: 100, temp: 68, setpoint: 71.6 }]);
  });

  it("returns nulls for a tick where the zone doesn't appear", () => {
    const points = [makePoint(100, { zones: [] })];
    const rows = buildZoneTemperatureData(points, "z1", "C");
    expect(rows).toEqual([{ time: 100, temp: null, setpoint: null }]);
  });
});

describe("buildVentPositionData", () => {
  it("reads commanded/reported/degraded for the matching vent", () => {
    const points = [
      makePoint(100, {
        zones: [
          makeZone({
            vents: [
              makeVent({
                flair_vent_id: "vent-1",
                commanded_position_pct: 40,
                reported_position_pct: 38,
                degraded: true,
              }),
            ],
          }),
        ],
      }),
    ];
    const rows = buildVentPositionData(points, "z1", "vent-1");
    expect(rows).toEqual([
      { time: 100, commanded: 40, reported: 38, degraded: true },
    ]);
  });

  it("returns nulls/false for a tick where the vent doesn't appear", () => {
    const points = [makePoint(100, { zones: [makeZone()] })];
    const rows = buildVentPositionData(points, "z1", "vent-1");
    expect(rows).toEqual([
      { time: 100, commanded: null, reported: null, degraded: false },
    ]);
  });
});

describe("buildOpenCapacityData", () => {
  it("reads aggregate open/cap percentages from the pressure block", () => {
    const points = [
      makePoint(100, {
        pressure: {
          aggregate_open_lps: 500,
          aggregate_open_pct: 45,
          floor_lps: 300,
          cap_pct: 80,
          clamped: false,
          blower_rated_flow_rate_is_estimate: false,
          minimum_aggregate_flow_is_estimate: false,
        },
      }),
    ];
    expect(buildOpenCapacityData(points)).toEqual([
      { time: 100, openPct: 45, capPct: 80 },
    ]);
  });

  it("returns nulls when pressure wasn't computed this tick", () => {
    const points = [makePoint(100, { pressure: null })];
    expect(buildOpenCapacityData(points)).toEqual([
      { time: 100, openPct: null, capPct: null },
    ]);
  });
});

describe("computeAgreementMetric", () => {
  it("averages the absolute delta across every vent sample with both sides present", () => {
    const points = [
      makePoint(100, {
        zones: [
          makeZone({
            vents: [
              makeVent({
                commanded_position_pct: 50,
                reported_position_pct: 40,
              }),
            ],
          }),
        ],
      }),
      makePoint(200, {
        zones: [
          makeZone({
            vents: [
              makeVent({
                commanded_position_pct: 30,
                reported_position_pct: 30,
              }),
            ],
          }),
        ],
      }),
    ];
    expect(computeAgreementMetric(points)).toEqual({
      meanAbsoluteDeltaPct: 5,
      sampleCount: 2,
    });
  });

  it("ignores samples missing either side and returns null when there are none", () => {
    const points = [
      makePoint(100, {
        zones: [
          makeZone({
            vents: [
              makeVent({
                commanded_position_pct: 50,
                reported_position_pct: null,
              }),
            ],
          }),
        ],
      }),
    ];
    expect(computeAgreementMetric(points)).toEqual({
      meanAbsoluteDeltaPct: null,
      sampleCount: 0,
    });
  });
});

describe("computeDegradedPeriodsForVent", () => {
  it("finds the degraded period for the given zone/vent only", () => {
    const points = [
      makePoint(100, {
        zones: [
          makeZone({
            zone_id: "z1",
            vents: [makeVent({ flair_vent_id: "v1", degraded: false })],
          }),
        ],
      }),
      makePoint(200, {
        zones: [
          makeZone({
            zone_id: "z1",
            vents: [makeVent({ flair_vent_id: "v1", degraded: true })],
          }),
        ],
      }),
    ];
    expect(computeDegradedPeriodsForVent(points, "z1", "v1", 300)).toEqual([
      { startMs: 200, endMs: 300 },
    ]);
    // A different vent id never went degraded in these points.
    expect(computeDegradedPeriodsForVent(points, "z1", "v2", 300)).toEqual([]);
  });
});

describe("computeFaultPeriodsForAirHandler", () => {
  it("finds equipment-fault periods across the window", () => {
    const points = [
      makePoint(100, { equipment_fault_active: false }),
      makePoint(200, { equipment_fault_active: true }),
      makePoint(300, { equipment_fault_active: false }),
    ];
    expect(computeFaultPeriodsForAirHandler(points, 400)).toEqual([
      { startMs: 200, endMs: 300 },
    ]);
  });
});

describe("findLatestVentName", () => {
  it("returns the most recent non-empty nickname for the vent", () => {
    const points = [
      makePoint(100, {
        zones: [
          makeZone({
            zone_id: "z1",
            vents: [makeVent({ flair_vent_id: "v1", name: "" })],
          }),
        ],
      }),
      makePoint(200, {
        zones: [
          makeZone({
            zone_id: "z1",
            vents: [makeVent({ flair_vent_id: "v1", name: "Den Front" })],
          }),
        ],
      }),
    ];
    expect(findLatestVentName(points, "z1", "v1")).toBe("Den Front");
  });

  it("returns null when the vent was never named", () => {
    const points = [
      makePoint(100, {
        zones: [
          makeZone({
            zone_id: "z1",
            vents: [makeVent({ flair_vent_id: "v1", name: "" })],
          }),
        ],
      }),
    ];
    expect(findLatestVentName(points, "z1", "v1")).toBeNull();
  });
});
