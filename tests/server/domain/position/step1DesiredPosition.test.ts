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
    demanding: false,
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
    expect(result.desiredPosition).toBe(100);
  });

  it("scales linearly across the band when demanding", () => {
    const halfway = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        demanding: true,
        calibratedTemp: asAbsoluteTemp(21 + 1.67 / 2),
      }),
    );
    expect(halfway.desiredPosition).toBeCloseTo(50, 0);
  });

  it("clamps at the ceiling once demand meets or exceeds the full band", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        demanding: true,
        calibratedTemp: asAbsoluteTemp(30),
      }),
    );
    expect(result.desiredPosition).toBe(100);
  });

  it("composes multiple simultaneous boosts by narrowing the band, not adding to output", () => {
    const oneBoost = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        demanding: true,
        calibratedTemp: asAbsoluteTemp(21.5),
        occupied: true,
      }),
    );
    const twoBoosts = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        demanding: true,
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
        demanding: true,
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
        demanding: true,
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
        demanding: true,
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
        demanding: true,
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
        demanding: true,
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

  // The whole point of externalizing `demanding` (see the field's own doc
  // comment): the caller's already-stabilized decision governs which branch
  // runs here, even when a fresh, unstabilized classification of the same
  // raw reading would disagree — a single-tick noise blip can't flip this
  // out from under the caller's own hysteresis dwell.
  it("honors the caller's stabilized demanding=true even when the raw deviation alone reads satisfied", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 100,
        minVentPosition: 0,
        demanding: true,
        tolerance: asTempDelta(1),
        calibratedTemp: asAbsoluteTemp(21), // deviation 0, well within tolerance -> raw would be "satisfied"
      }),
    );
    // The demanding (opening) branch ran, not the closing one — desired
    // position moves toward maxPositionPct from idleBaselinePosition, not
    // down toward minVentPosition.
    expect(result.desiredPosition).toBe(100);
  });

  it("honors the caller's stabilized demanding=false even when the raw deviation alone reads demanding", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        minVentPosition: 0,
        demanding: false,
        tolerance: null,
        calibratedTemp: asAbsoluteTemp(30), // way past setpoint -> raw would be "demanding"
      }),
    );
    // The satisfied (closing) branch ran — desired position stays pinned at
    // idleBaselinePosition (0 here), never ramping up toward the ceiling.
    expect(result.desiredPosition).toBe(0);
  });

  // Regression coverage for a real gap found live: a satisfied zone
  // previously held flat at idle_baseline_position forever once satisfied,
  // with nothing correcting an already-overcooled room — see "the goal is
  // staying as close to target as possible at all times" in the
  // implementation plan follow-up. This mirrors the demanding-side ramp
  // exactly, just closing instead of opening.
  describe("closing proportionally once satisfied", () => {
    it("stays exactly at idle baseline right at the demanding/satisfied boundary (continuous with the demanding branch)", () => {
      const result = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          tolerance: asTempDelta(1),
          calibratedTemp: asAbsoluteTemp(22), // deviation = 22-21 = 1 = tolerance exactly
        }),
      );
      expect(result.desiredPosition).toBe(100);
    });

    it("closes partway as the room gets colder past the comfort boundary", () => {
      const result = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          tolerance: asTempDelta(1),
          // deviation = 21 - 21 = 0 (colder than setpoint by 1 relative to
          // the tolerance edge) -> overshoot = 1 - 0 = 1 against a
          // 1.67 effectiveBand -> ~40% closed toward the floor.
          calibratedTemp: asAbsoluteTemp(21),
        }),
      );
      expect(result.desiredPosition).toBeLessThan(100);
      expect(result.desiredPosition).toBeGreaterThan(0);
    });

    it("fully closes to min_vent_position once far enough past comfortable", () => {
      const result = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 5,
          tolerance: asTempDelta(1),
          // deviation = 15 - 21 = -6, overshoot = 1 - (-6) = 7, far past a
          // 1.67 effectiveBand -> saturates at the floor, not below it.
          calibratedTemp: asAbsoluteTemp(15),
        }),
      );
      expect(result.desiredPosition).toBe(5);
    });

    it("closes an occupied zone too — occupancy no longer holds a satisfied zone open indefinitely", () => {
      const result = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          tolerance: asTempDelta(1),
          calibratedTemp: asAbsoluteTemp(15),
          occupied: true,
        }),
      );
      expect(result.desiredPosition).toBe(0);
    });

    it("a boost narrows the closing band too, same as it narrows the opening band", () => {
      const unboosted = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          tolerance: asTempDelta(1),
          calibratedTemp: asAbsoluteTemp(20.5),
        }),
      );
      const boosted = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          tolerance: asTempDelta(1),
          calibratedTemp: asAbsoluteTemp(20.5),
          occupied: true, // narrows effectiveBand -> reaches the floor sooner
        }),
      );
      expect(unboosted.desiredPosition).toBeGreaterThan(0);
      expect(boosted.desiredPosition).toBeLessThan(unboosted.desiredPosition);
    });
  });
});
