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

  // Regression coverage for "Multi-Vent Manual Zones": a manual_fixed_vent
  // zone's vents can each sit at a genuinely different position — the
  // aggregate must sum each vent's own contribution, not just multiply one
  // shared position by a combined flow rate.
  it("sums each manual vent's own contribution when manualVents is given", () => {
    const result = computeAggregate(
      [
        zone({
          zoneId: "manual",
          ventHardwareType: "manual_fixed_vent",
          manualVents: [
            { position: 75, flowRateLps: 40 },
            { position: 25, flowRateLps: 20 },
          ],
        }),
      ],
      1000,
    );
    expect(result.aggregateOpenLps).toBe(0.75 * 40 + 0.25 * 20);
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
      null,
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
    const result = clampToPressureFloor(ranked, 0, 50, null);
    expect(result.positions["high-priority"]).toBeGreaterThan(0);
    expect(result.positions["low-priority"]).toBeUndefined();
  });

  it("flags insufficient when every zone is already at its ceiling", () => {
    const ranked = [
      { zoneId: "a", position: 100, maxVentPosition: 100, flowRateLps: 100 },
    ];
    const result = clampToPressureFloor(ranked, 0, 500, null);
    expect(result.insufficient).toBe(true);
  });

  it("does not crash on a zero flow-rate zone (0% openable, not NaN)", () => {
    const ranked = [
      { zoneId: "a", position: 0, maxVentPosition: 100, flowRateLps: 0 },
    ];
    const result = clampToPressureFloor(ranked, 0, 50, null);
    expect(result.insufficient).toBe(true);
    expect(Number.isNaN(result.positions["a"] ?? 0)).toBe(false);
  });

  // Regression coverage for discrete_position_step_pct's own real gap:
  // this function used to compute an unquantized float regardless of any
  // grid the rest of the pipeline was enforcing — see
  // clampToPressureFloor's own quantizeStepPct comment.
  it("quantizes a reopened position UP to the effective step, never to nearest", () => {
    const ranked = [
      { zoneId: "a", position: 0, maxVentPosition: 100, flowRateLps: 100 },
    ];
    // Raw computed reopen is exactly 60% (60 of a 100 Lps-rated vent) —
    // round-to-nearest-25 would give 50 (still short of the 60 Lps
    // floor), so this proves it rounds up to 75 instead.
    const result = clampToPressureFloor(ranked, 0, 60, 25);
    expect(result.positions["a"]).toBe(75);
  });

  it("uses the actual quantized amount, not the raw pre-quantize estimate, when deciding whether a lower-priority zone still needs to open", () => {
    const ranked = [
      { zoneId: "high", position: 0, maxVentPosition: 100, flowRateLps: 100 },
      { zoneId: "low", position: 0, maxVentPosition: 100, flowRateLps: 100 },
    ];
    // The raw reopen for "high" is exactly 60%, still short of the 60 Lps
    // floor on its own — but rounding UP to the nearest 25 (75%) actually
    // delivers 75 Lps, already past the floor, so "low" should never be
    // asked to open at all.
    const result = clampToPressureFloor(ranked, 0, 60, 25);
    expect(result.positions["high"]).toBe(75);
    expect(result.positions["low"]).toBeUndefined();
  });
});
