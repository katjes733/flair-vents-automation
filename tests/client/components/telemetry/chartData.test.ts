import { describe, it, expect } from "vitest";
import {
  buildZoneTemperatureData,
  buildVentPositionData,
  buildOpenCapacityData,
  computeOpenCapacityYTicks,
  computeAgreementMetric,
  computeDegradedPeriodsForVent,
  computeFaultPeriodsForAirHandler,
  findLatestVentName,
  computeOverrideSegments,
} from "~/client/components/telemetry/chartData";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import type {
  AirHandlerTickDecision,
  VentTickDecisionRecord,
  ZoneTickDecisionRecord,
} from "~/client/api/airHandlersApi";
import type { ManualOverrideRecord } from "~/client/api/overridesApi";

function makeVent(
  overrides: Partial<VentTickDecisionRecord> = {},
): VentTickDecisionRecord {
  return {
    flair_vent_id: "vent-1",
    name: "",
    commanded_position_pct: null,
    reported_position_pct: null,
    dispatch_decision: "dispatched",
    step_delta_pct: null,
    min_step_delta_pct: null,
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

describe("computeOpenCapacityYTicks", () => {
  it("covers at least 0-100 with clean, evenly-spaced ticks when data stays under 100%", () => {
    const data = [
      { time: 100, openPct: 45, capPct: 80 },
      { time: 200, openPct: 60, capPct: 80 },
    ];
    const ticks = computeOpenCapacityYTicks(data, 80);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(100);
    // Every tick is a whole number — the actual bug being regression-tested
    // (a raw, unrounded float landing as the final tick).
    for (const t of ticks) {
      expect(Number.isInteger(t)).toBe(true);
    }
  });

  it("extends the domain with whole-number ticks when real data exceeds 100%", () => {
    // Regression test: live production data hit 157.70078406442045% —
    // confirmed via a real screenshot showing that exact unrounded value as
    // an axis tick under the old fixed [0, 100] domain.
    const data = [{ time: 100, openPct: 157.70078406442045, capPct: null }];
    const ticks = computeOpenCapacityYTicks(data, null);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(157.70078406442045);
    for (const t of ticks) {
      expect(Number.isInteger(t)).toBe(true);
    }
  });

  it("accounts for the cap line even when it exceeds every data point", () => {
    const data = [{ time: 100, openPct: 20, capPct: 200 }];
    const ticks = computeOpenCapacityYTicks(data, 200);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(200);
  });

  it("defaults to a plain 0-100 scale with no data at all", () => {
    expect(computeOpenCapacityYTicks([], null)).toEqual([
      0, 20, 40, 60, 80, 100,
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

function makeOverride(
  overrides: Partial<ManualOverrideRecord> = {},
): ManualOverrideRecord {
  return {
    id: "mo-1",
    zoneId: "z1",
    config: {
      kind: "position",
      value: 40,
      hold_type: "permanent",
      actor: "Martin",
    },
    createdAtMs: 100,
    expiresAtMs: null,
    revokedAtMs: null,
    ...overrides,
  };
}

describe("computeOverrideSegments", () => {
  it("ends a permanent, never-revoked hold at the domain end", () => {
    const segments = computeOverrideSegments(
      [
        makeOverride({
          createdAtMs: 100,
          expiresAtMs: null,
          revokedAtMs: null,
        }),
      ],
      1000,
    );
    expect(segments).toEqual([
      { startMs: 100, endMs: 1000, override: expect.anything() },
    ]);
  });

  it("ends at the natural expiry when set and not revoked", () => {
    const segments = computeOverrideSegments(
      [makeOverride({ createdAtMs: 100, expiresAtMs: 300, revokedAtMs: null })],
      1000,
    );
    expect(segments[0].endMs).toBe(300);
  });

  it("prefers an explicit revocation over the natural expiry", () => {
    const segments = computeOverrideSegments(
      [
        makeOverride({
          createdAtMs: 100,
          expiresAtMs: 900,
          revokedAtMs: 250,
        }),
      ],
      1000,
    );
    expect(segments[0].endMs).toBe(250);
  });

  it("caps an older row's end at the moment the next one was created, even though nothing revoked it", () => {
    // Regression test for the actual "last-write-wins" bug this function
    // exists to avoid: the manual_overrides table never marks an older row
    // as superseded when a newer one for the same zone is created (see the
    // Data Model's append-only rule) — without this cap, both rows would
    // render as simultaneously "active" on the lane, which never happened.
    const older = makeOverride({
      id: "mo-1",
      createdAtMs: 100,
      expiresAtMs: 900, // would naturally run long past the newer hold's start
      revokedAtMs: null,
    });
    const newer = makeOverride({
      id: "mo-2",
      createdAtMs: 300,
      expiresAtMs: null,
      revokedAtMs: null,
    });
    // Deliberately passed newest-first — the function must sort, not trust
    // caller order.
    const segments = computeOverrideSegments([newer, older], 1000);
    const olderSegment = segments.find((s) => s.override.id === "mo-1");
    const newerSegment = segments.find((s) => s.override.id === "mo-2");
    expect(olderSegment?.endMs).toBe(300);
    expect(newerSegment).toEqual({
      startMs: 300,
      endMs: 1000,
      override: newer,
    });
  });
});
