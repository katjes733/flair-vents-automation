import { describe, it, expect } from "vitest";
import {
  detectEquipmentFault,
  detectDuctAirflowAnomaly,
  buildFailSafeCommands,
  type DuctReadingZone,
} from "~/server/domain/state/emergency";

function zone(overrides: Partial<DuctReadingZone>): DuctReadingZone {
  return {
    zoneId: "z1",
    hasSmartVent: true,
    ductTemperatureC: 15,
    ductReadingStale: false,
    roomTemperatureC: 22,
    demanding: true,
    commandedPositionPct: 100,
    ...overrides,
  };
}

describe("detectEquipmentFault", () => {
  const base = {
    state: "COOLING_CALL" as const,
    gracePeriodMinutes: 10,
    ductDeltaThresholdC: 5.56,
    minVentOpenPct: 20,
  };

  it("never faults within the grace period, even with zero differential everywhere", () => {
    const result = detectEquipmentFault({
      ...base,
      callDurationMinutes: 5,
      zones: [zone({ ductTemperatureC: 22 })],
    });
    expect(result.faulted).toBe(false);
  });

  it("faults only once every smart vent with fresh duct data fails the differential past the grace period", () => {
    const result = detectEquipmentFault({
      ...base,
      callDurationMinutes: 15,
      zones: [
        zone({ ductTemperatureC: 22 }),
        zone({ zoneId: "z2", ductTemperatureC: 21.5 }),
      ],
    });
    expect(result.faulted).toBe(true);
  });

  it("does not fault if even one vent shows the expected differential", () => {
    const result = detectEquipmentFault({
      ...base,
      callDurationMinutes: 15,
      zones: [
        zone({ ductTemperatureC: 15 }),
        zone({ zoneId: "z2", ductTemperatureC: 22 }),
      ],
    });
    expect(result.faulted).toBe(false);
  });

  it("excludes a stale/missing duct reading rather than treating it as failing", () => {
    const result = detectEquipmentFault({
      ...base,
      callDurationMinutes: 15,
      zones: [zone({ ductReadingStale: true, ductTemperatureC: 22 })],
    });
    expect(result.faulted).toBe(false);
    expect(result.reason).toMatch(/no usable duct data/);
  });

  it("stays dormant (not a false negative) when a handler has zero smart-vent duct data", () => {
    const result = detectEquipmentFault({
      ...base,
      callDurationMinutes: 60,
      zones: [zone({ hasSmartVent: false })],
    });
    expect(result.faulted).toBe(false);
    expect(result.reason).toMatch(/dormant/);
  });

  // Regression test for a real, confirmed logging bug: the fault-trigger
  // log used to report the configured threshold constant instead of the
  // actual measured differential, making a real production trigger
  // undiagnosable after the fact. The real per-vent deltas must be
  // returned so the caller can log them.
  it("returns the real, per-vent normalized deltas alongside a faulted result", () => {
    const result = detectEquipmentFault({
      ...base,
      callDurationMinutes: 15,
      zones: [
        zone({
          zoneId: "z1",
          ventId: "v1",
          roomTemperatureC: 24,
          ductTemperatureC: 23,
        }),
        zone({
          zoneId: "z2",
          ventId: "v2",
          roomTemperatureC: 22,
          ductTemperatureC: 22,
        }),
      ],
    });
    expect(result.faulted).toBe(true);
    expect(result.ductDeltasC).toEqual([
      { zoneId: "z1", ventId: "v1", deltaC: 1 },
      { zoneId: "z2", ventId: "v2", deltaC: 0 },
    ]);
  });

  it("normalizes the delta sign for a heating call (positive still means closer to passing)", () => {
    const result = detectEquipmentFault({
      state: "HEATING_CALL",
      gracePeriodMinutes: 10,
      ductDeltaThresholdC: 5.56,
      minVentOpenPct: 20,
      callDurationMinutes: 15,
      zones: [
        zone({
          zoneId: "z1",
          ventId: "v1",
          roomTemperatureC: 20,
          ductTemperatureC: 21,
        }),
      ],
    });
    expect(result.faulted).toBe(true);
    expect(result.ductDeltasC).toEqual([
      { zoneId: "z1", ventId: "v1", deltaC: 1 },
    ]);
  });

  // Regression test for a real, confirmed live false-positive: a call was
  // sustained entirely by manual-vent zones (no duct sensor at all), while
  // every smart vent happened to be satisfied-and-mostly-closed at the
  // same moment the grace period elapsed — leaving no genuinely usable
  // duct reading, yet the old code still tripped a fault since a
  // near-closed vent's stale-toward-room-ambient reading was still
  // counted as "usable." See "Emergency fail-safe" in the plan.
  it("excludes a near-closed vent from 'usable' — a closed vent's duct reading doesn't mean anything, real incident", () => {
    const result = detectEquipmentFault({
      ...base,
      callDurationMinutes: 15,
      zones: [
        zone({
          zoneId: "closed",
          commandedPositionPct: 0,
          roomTemperatureC: 22.4,
          ductTemperatureC: 21.5, // small delta — a near-closed vent's stale, room-adjacent reading
        }),
        zone({
          zoneId: "barely-open",
          commandedPositionPct: 10,
          roomTemperatureC: 22.9,
          ductTemperatureC: 18.6, // real, but not enough — 20% is the configured floor
        }),
      ],
    });
    expect(result.faulted).toBe(false);
    expect(result.reason).toMatch(/no usable duct data/);
  });

  it("still counts a vent open at or above the configured minVentOpenPct as usable", () => {
    const result = detectEquipmentFault({
      ...base,
      callDurationMinutes: 15,
      zones: [
        zone({
          commandedPositionPct: 20,
          roomTemperatureC: 22,
          ductTemperatureC: 15,
        }),
      ],
    });
    expect(result.faulted).toBe(false);
    expect(result.reason).toMatch(/expected duct differential/);
  });
});

describe("detectDuctAirflowAnomaly", () => {
  const base = {
    state: "COOLING_CALL" as const,
    ductDeltaThresholdC: 5.56,
    minVentOpenPct: 20,
  };

  it("flags a demanding, meaningfully-open zone whose duct fails while a sibling passes", () => {
    const results = detectDuctAirflowAnomaly({
      ...base,
      zones: [
        zone({
          zoneId: "failing",
          ductTemperatureC: 22,
          demanding: true,
          commandedPositionPct: 80,
        }),
        zone({ zoneId: "passing", ductTemperatureC: 15 }),
      ],
    });
    expect(results.find((r) => r.zoneId === "failing")?.anomalous).toBe(true);
  });

  it("does not flag when every vent fails the differential (that's detectEquipmentFault's case)", () => {
    const results = detectDuctAirflowAnomaly({
      ...base,
      zones: [
        zone({ zoneId: "a", ductTemperatureC: 22 }),
        zone({ zoneId: "b", ductTemperatureC: 22 }),
      ],
    });
    expect(results.every((r) => !r.anomalous)).toBe(true);
  });

  it("does not flag a zone resting at idle baseline (not demanding/commanded)", () => {
    const results = detectDuctAirflowAnomaly({
      ...base,
      zones: [
        zone({
          zoneId: "idle",
          ductTemperatureC: 22,
          demanding: false,
          commandedPositionPct: 30, // open enough to be "usable," but not demanding
        }),
        zone({ zoneId: "passing", ductTemperatureC: 15 }),
      ],
    });
    expect(results.find((r) => r.zoneId === "idle")?.anomalous).toBe(false);
  });

  // A zone below minVentOpenPct is excluded from "usable" entirely now
  // (see detectEquipmentFault's own regression test above for why) — it
  // no longer appears in the results at all, rather than appearing with
  // anomalous:false.
  it("excludes a near-closed vent from the result set entirely, rather than reporting it as not-anomalous", () => {
    const results = detectDuctAirflowAnomaly({
      ...base,
      zones: [
        zone({
          zoneId: "closed",
          ductTemperatureC: 22,
          demanding: false,
          commandedPositionPct: 0,
        }),
        zone({ zoneId: "passing", ductTemperatureC: 15 }),
      ],
    });
    expect(results.find((r) => r.zoneId === "closed")).toBeUndefined();
  });
});

describe("buildFailSafeCommands", () => {
  it("forces every given zone to 100%", () => {
    expect(buildFailSafeCommands(["a", "b"])).toEqual({ a: 100, b: 100 });
  });
});
