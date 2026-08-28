import { describe, it, expect } from "vitest";
import {
  computeAggregate,
  clampToPressureFloor,
} from "~/server/domain/pressure/pressureSafeguard";
import type { PressureZoneInput } from "~/server/domain/pressure/pressureSafeguard";

function zone(overrides: Partial<PressureZoneInput>): PressureZoneInput {
  return {
    zoneId: "z",
    ventHardwareType: "flair_smart_vent",
    position: 100,
    flowRateLps: 47,
    degraded: false,
    ...overrides,
  };
}

describe("computeAggregate", () => {
  it("weights by flow rate and position", () => {
    const result = computeAggregate(
      [zone({ zoneId: "a", position: 50, flowRateLps: 100 })],
      1000,
    );
    expect(result.aggregateOpenLps).toBe(50);
    expect(result.aggregateOpenPct).toBe(5);
  });

  it("excludes no_vent zones entirely", () => {
    const result = computeAggregate(
      [
        zone({
          zoneId: "novent",
          ventHardwareType: "no_vent",
          position: 100,
          flowRateLps: 100,
        }),
      ],
      1000,
    );
    expect(result.aggregateOpenLps).toBe(0);
  });

  it("includes manual_fixed_vent zones at their assumed position", () => {
    const result = computeAggregate(
      [
        zone({
          zoneId: "manual",
          ventHardwareType: "manual_fixed_vent",
          position: 30,
          flowRateLps: 100,
        }),
      ],
      1000,
    );
    expect(result.aggregateOpenLps).toBe(30);
  });

  it("fully excludes degraded vents, even though they occupy a real position", () => {
    const result = computeAggregate(
      [
        zone({
          zoneId: "degraded",
          position: 100,
          flowRateLps: 100,
          degraded: true,
        }),
      ],
      1000,
    );
    expect(result.aggregateOpenLps).toBe(0);
  });

  it("reports 0% (not NaN/Infinity) when the blower rating itself is 0", () => {
    const result = computeAggregate([zone({ position: 50 })], 0);
    expect(result.aggregateOpenPct).toBe(0);
  });
});

describe("clampToPressureFloor", () => {
  it("does nothing when already at or above the floor", () => {
    const result = clampToPressureFloor(
      [{ zoneId: "a", position: 50, maxVentPosition: 100, flowRateLps: 100 }],
      500,
      500,
    );
    expect(result.clamped).toBe(false);
  });

  it("reopens the highest-priority (first-ranked) zone first", () => {
    const ranked = [
      {
        zoneId: "high-priority",
        position: 0,
        maxVentPosition: 100,
        flowRateLps: 100,
      },
      {
        zoneId: "low-priority",
        position: 0,
        maxVentPosition: 100,
        flowRateLps: 100,
      },
    ];
    const result = clampToPressureFloor(ranked, 0, 50);
    expect(result.positions["high-priority"]).toBeGreaterThan(0);
    expect(result.positions["low-priority"]).toBeUndefined();
  });

  it("flags insufficient when every zone is already at its ceiling", () => {
    const ranked = [
      { zoneId: "a", position: 100, maxVentPosition: 100, flowRateLps: 100 },
    ];
    const result = clampToPressureFloor(ranked, 0, 500);
    expect(result.insufficient).toBe(true);
  });

  it("does not crash on a zero flow-rate zone (0% openable, not NaN)", () => {
    const ranked = [
      { zoneId: "a", position: 0, maxVentPosition: 100, flowRateLps: 0 },
    ];
    const result = clampToPressureFloor(ranked, 0, 50);
    expect(result.insufficient).toBe(true);
    expect(Number.isNaN(result.positions["a"] ?? 0)).toBe(false);
  });
});
