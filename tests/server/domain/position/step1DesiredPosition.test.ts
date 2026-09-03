import { describe, it, expect } from "vitest";
import {
  computeDesiredPosition,
  type DesiredPositionInput,
} from "~/server/domain/position/step1DesiredPosition";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";

function base(
  overrides: Partial<DesiredPositionInput> = {},
): DesiredPositionInput {
  return {
    idleBaselinePosition: 100,
    minVentPosition: 0,
    maxVentPosition: 100,
    thermalLoadFlags: [],
    hasTemperatureSensor: true,
    state: "COOLING_CALL",
    calibratedTemp: asAbsoluteTemp(21),
    resolvedSetpoint: asAbsoluteTemp(21),
    tolerance: null,
    occupied: false,
    spiking: false,
    settings: {
      proportionalBandWidthC: asTempDelta(1.67),
      maxPositionPct: 100,
      modifierBoosts: {
        occupancy: 0.3,
        spike: 0.3,
        highInternalHeatLoad: 0.3,
        distantHighDuctLoss: 0.3,
      },
      heatingChokePositionPct: 20,
    },
    ...overrides,
  };
}

describe("computeDesiredPosition", () => {
  it("holds at idle baseline when satisfied (deviation within tolerance)", () => {
    const result = computeDesiredPosition(base());
    expect(result.demanding).toBe(false);
    expect(result.desiredPosition).toBe(100);
  });

  it("scales linearly across the band when demanding", () => {
    const halfway = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        calibratedTemp: asAbsoluteTemp(21 + 1.67 / 2),
      }),
    );
    expect(halfway.demanding).toBe(true);
    expect(halfway.desiredPosition).toBeCloseTo(50, 0);
  });

  it("clamps at the ceiling once demand meets or exceeds the full band", () => {
    const result = computeDesiredPosition(
      base({ idleBaselinePosition: 0, calibratedTemp: asAbsoluteTemp(30) }),
    );
    expect(result.desiredPosition).toBe(100);
  });

  it("composes multiple simultaneous boosts by narrowing the band, not adding to output", () => {
    const oneBoost = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        calibratedTemp: asAbsoluteTemp(21.5),
        occupied: true,
      }),
    );
    const twoBoosts = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        calibratedTemp: asAbsoluteTemp(21.5),
        occupied: true,
        spiking: true,
      }),
    );
    expect(twoBoosts.desiredPosition).toBeGreaterThanOrEqual(
      oneBoost.desiredPosition,
    );
  });

  it("chokes to heatingChokePositionPct in HEATING_CALL for high_internal_heat_load, beating boosts", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(10),
        resolvedSetpoint: asAbsoluteTemp(21),
        thermalLoadFlags: ["high_internal_heat_load"],
      }),
    );
    expect(result.desiredPosition).toBe(20);
    expect(result.clampedBy).toBe("heating_choke");
  });

  it("also chokes an actively spiking zone in HEATING_CALL", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(10),
        resolvedSetpoint: asAbsoluteTemp(21),
        spiking: true,
      }),
    );
    expect(result.clampedBy).toBe("heating_choke");
  });

  it("distant_high_duct_loss persists (not choked) into HEATING_CALL", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(10),
        resolvedSetpoint: asAbsoluteTemp(21),
        thermalLoadFlags: ["distant_high_duct_loss"],
      }),
    );
    expect(result.clampedBy).not.toBe("heating_choke");
  });

  it("clamps at zone_min when a misconfigured idle baseline sits below min_vent_position", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        minVentPosition: 10,
        calibratedTemp: asAbsoluteTemp(21.01),
      }),
    );
    expect(result.desiredPosition).toBe(10);
    expect(result.clampedBy).toBe("zone_min");
  });

  it("clamps at zone_max when the zone's own ceiling is below the system max", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        maxVentPosition: 50,
        calibratedTemp: asAbsoluteTemp(30),
      }),
    );
    expect(result.desiredPosition).toBe(50);
    expect(result.clampedBy).toBe("zone_max");
  });

  it("pins and warns when the system max is below the zone's own idle baseline", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 60,
        settings: { ...base().settings, maxPositionPct: 40 },
      }),
    );
    expect(result.desiredPosition).toBe(40);
    expect(result.clampedBy).toBe("max_position_below_idle_baseline");
  });
});
