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
});

describe("detectDuctAirflowAnomaly", () => {
  const base = { state: "COOLING_CALL" as const, ductDeltaThresholdC: 5.56 };

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
          commandedPositionPct: 0,
        }),
        zone({ zoneId: "passing", ductTemperatureC: 15 }),
      ],
    });
    expect(results.find((r) => r.zoneId === "idle")?.anomalous).toBe(false);
  });
});

describe("buildFailSafeCommands", () => {
  it("forces every given zone to 100%", () => {
    expect(buildFailSafeCommands(["a", "b"])).toEqual({ a: 100, b: 100 });
  });
});
