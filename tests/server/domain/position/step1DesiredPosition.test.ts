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
    wasDemanding: false,
    state: "COOLING_CALL",
    calibratedTemp: asAbsoluteTemp(21),
    resolvedSetpoint: asAbsoluteTemp(21),
    demandTolerance: null,
    overshootTolerance: null,
    occupied: false,
    spiking: false,
    callActive: true,
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
      modulationStepPct: 10,
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
        // Above idleBaselinePosition + modulationStepPct (10) so this
        // exercises zone_min itself, not just the demand floor below it.
        minVentPosition: 20,
        calibratedTemp: asAbsoluteTemp(21.01),
      }),
    );
    expect(result.desiredPosition).toBe(20);
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

  // Regression coverage for a real incident: Martin Bedroom sat
  // "demanding" for 53 straight minutes at a literal 0% target overnight
  // once satisfied_baseline_position moved to 0 — a deviation only
  // just past demandTolerance computed a ratio near 0, landing exactly on
  // idleBaselinePosition instead of some meaningfully-open position.
  it("floors a barely-demanding zone at one step above idle baseline instead of collapsing to it", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        demanding: true,
        demandTolerance: asTempDelta(0.56),
        // deviation = 0.61, only just past demandTolerance — the raw ratio
        // alone would compute well under one modulation step (10).
        calibratedTemp: asAbsoluteTemp(21.61),
      }),
    );
    expect(result.desiredPosition).toBe(10);
    expect(result.clampedBy).toBe("demand_floor");
  });

  it("leaves a substantially-demanding zone's own ratio alone — the floor only raises, never lowers", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        demanding: true,
        calibratedTemp: asAbsoluteTemp(21 + 1.67 / 2), // same fixture as the "scales linearly" test
      }),
    );
    expect(result.desiredPosition).toBeCloseTo(50, 0);
    expect(result.clampedBy).not.toBe("demand_floor");
  });

  // The heating choke is a safety ceiling, not just "whichever clamp fired
  // first" — it must keep final say even over a floor that raised the
  // position moments earlier in the same call.
  it("lets the heating choke override the demand floor, not the other way around", () => {
    const result = computeDesiredPosition(
      base({
        idleBaselinePosition: 0,
        demanding: true,
        state: "HEATING_CALL",
        thermalLoadFlags: ["high_internal_heat_load"],
        // deviation ~0 -> ratio ~0 -> demand floor would raise this to 10,
        // but a choke ceiling below that must still win.
        calibratedTemp: asAbsoluteTemp(21),
        settings: { ...base().settings, heatingChokePositionPct: 5 },
      }),
    );
    expect(result.desiredPosition).toBe(5);
    expect(result.clampedBy).toBe("heating_choke");
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
        demandTolerance: asTempDelta(0.5),
        overshootTolerance: asTempDelta(0.5),
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
        demandTolerance: null,
        overshootTolerance: null,
        calibratedTemp: asAbsoluteTemp(30), // way past setpoint -> raw would be "demanding"
      }),
    );
    // The satisfied (closing) branch ran — desired position stays pinned at
    // idleBaselinePosition (0 here), never ramping up toward the ceiling.
    expect(result.desiredPosition).toBe(0);
  });

  // Regression coverage for a real, confirmed incident (2026-09-15, Martin
  // Office): a zone that's already demanding stayed correctly classified
  // that way per classifyZone's own asymmetric hysteresis, but this ramp
  // kept anchoring to demandToleranceC regardless — computing a near-zero
  // effectiveDemand (floored to a bare trickle) for the entire stretch
  // between setpoint and setpoint+demandTolerance, even though the zone
  // was actively, currently demanding there. A zone stuck on a trickle
  // that can't finish closing a real gap never crosses back to satisfied,
  // which can keep the whole air handler's call running indefinitely.
  describe("an already-demanding zone keeps scaling off the full deviation, not just the entry threshold", () => {
    it("computes a meaningfully larger position once wasDemanding is true, for the exact same deviation", () => {
      const fixture = {
        idleBaselinePosition: 0,
        demanding: true,
        demandTolerance: asTempDelta(0.56),
        overshootTolerance: null,
        // deviation = 0.5°C — inside demandTolerance (0.56), so a fresh
        // entry would compute ~zero effective demand (floored to a
        // trickle), but the zone is genuinely, currently demanding.
        calibratedTemp: asAbsoluteTemp(21.5),
      };
      const freshEntry = computeDesiredPosition(
        base({ ...fixture, wasDemanding: false }),
      );
      const alreadyDemanding = computeDesiredPosition(
        base({ ...fixture, wasDemanding: true }),
      );
      expect(freshEntry.desiredPosition).toBe(10); // demand floor only
      expect(freshEntry.clampedBy).toBe("demand_floor");
      // effectiveDemand = 0.5 - (-0) = 0.5; ratio = 0.5/1.67 ≈ 0.30.
      expect(alreadyDemanding.desiredPosition).toBeCloseTo(30, 0);
      expect(alreadyDemanding.clampedBy).toBeNull();
    });

    it("keeps scaling all the way down to zero exactly at the point classifyZone would flip it back to satisfied", () => {
      const result = computeDesiredPosition(
        base({
          idleBaselinePosition: 0,
          demanding: true,
          wasDemanding: true,
          demandTolerance: asTempDelta(0.56),
          overshootTolerance: null,
          // deviation = 0 — exactly setpoint, classifyZone's own edge for
          // an already-demanding zone to go satisfied (-overshootToleranceC
          // = 0 here).
          calibratedTemp: asAbsoluteTemp(21),
        }),
      );
      // demand_floor still applies (0 while genuinely demanding is still
      // disallowed) — the point is the *ratio* itself bottoms out here,
      // not that the position reaches a literal 0.
      expect(result.clampedBy).toBe("demand_floor");
    });

    it("preserves continuity at the fresh-entry transition itself — wasDemanding only changes behavior on the tick after", () => {
      // At exactly the entry threshold, a fresh entry's ratio is 0 by
      // construction (matching the satisfied branch's own flat output
      // right up to this same point) — confirming the asymmetric edge
      // doesn't retroactively change anything about that first tick.
      const result = computeDesiredPosition(
        base({
          idleBaselinePosition: 0,
          demanding: true,
          wasDemanding: false,
          demandTolerance: asTempDelta(0.56),
          overshootTolerance: null,
          calibratedTemp: asAbsoluteTemp(21.56),
        }),
      );
      expect(result.clampedBy).toBe("demand_floor");
    });
  });

  // Regression coverage for a real gap found live: a satisfied zone
  // previously held flat at idle_baseline_position forever once satisfied,
  // with nothing correcting an already-overcooled room — see "the goal is
  // staying as close to target as possible at all times" in the
  // implementation plan follow-up. This mirrors the demanding-side ramp
  // exactly, just closing instead of opening.
  describe("closing proportionally once satisfied", () => {
    it("stays exactly at idle baseline throughout the dead band, continuous with the demanding branch's own zero point", () => {
      const result = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          // deviation = 22-21 = 1, above the dead band's own upper edge
          // (setpoint + tolerance/2 = 21.5) — a real caller would already
          // be classified demanding here, but this function only cares
          // about the `demanding` flag it's given, not deviation's sign on
          // its own, so this still exercises the satisfied/closing branch
          // directly and confirms its zero point (overshoot=0 at
          // setpoint - tolerance/2 = 20.5) is never reached this far above.
          calibratedTemp: asAbsoluteTemp(22),
        }),
      );
      expect(result.desiredPosition).toBe(100);
    });

    it("closes partway as the room gets colder past the comfort boundary", () => {
      const result = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          // The closing curve's own zero point is the *lower* edge of the
          // symmetric hysteresis band (setpoint - tolerance/2 = 20.5), not
          // the full tolerance above setpoint — see classifyZone's own
          // comment. deviation = 20 - 21 = -1, overshoot = 0.5 - 1 = 0.5
          // against a 1.67 effectiveBand -> ~30% closed toward the floor.
          calibratedTemp: asAbsoluteTemp(20),
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
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          // deviation = 15 - 21 = -6, overshoot = 0.5 - (-6) = 6.5, far past
          // a 1.67 effectiveBand -> saturates at the floor, not below it.
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
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          calibratedTemp: asAbsoluteTemp(15),
          occupied: true,
        }),
      );
      expect(result.desiredPosition).toBe(0);
    });

    it("a boost narrows the closing band too, same as it narrows the opening band", () => {
      // deviation = 20 - 21 = -1, past the lower edge (20.5) either way —
      // see the previous test for why the edge sits there, not at setpoint.
      const unboosted = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          calibratedTemp: asAbsoluteTemp(20),
        }),
      );
      const boosted = computeDesiredPosition(
        base({
          idleBaselinePosition: 100,
          minVentPosition: 0,
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          calibratedTemp: asAbsoluteTemp(20),
          occupied: true, // narrows effectiveBand -> reaches the floor sooner
        }),
      );
      expect(unboosted.desiredPosition).toBeGreaterThan(0);
      expect(boosted.desiredPosition).toBeLessThan(unboosted.desiredPosition);
    });
  });

  describe("holding flat while satisfied during genuine idle (callActive: false)", () => {
    it("holds exactly at idle baseline regardless of overshoot, instead of closing toward min_vent_position", () => {
      const result = computeDesiredPosition(
        base({
          callActive: false,
          idleBaselinePosition: 50,
          minVentPosition: 5,
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          // Same deviation as "fully closes to min_vent_position once far
          // enough past comfortable" above — with callActive the same
          // input saturates all the way down to min_vent_position (5); the
          // only difference here is callActive: false.
          calibratedTemp: asAbsoluteTemp(15),
        }),
      );
      expect(result.desiredPosition).toBe(50);
    });

    it("holds flat for an occupied zone too — occupancy plays no role once callActive is false", () => {
      const result = computeDesiredPosition(
        base({
          callActive: false,
          idleBaselinePosition: 50,
          minVentPosition: 0,
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          calibratedTemp: asAbsoluteTemp(15),
          occupied: true,
        }),
      );
      expect(result.desiredPosition).toBe(50);
    });

    it("the exact same overshoot closes proportionally when callActive is true, but holds flat when false", () => {
      const overshotInput = {
        idleBaselinePosition: 100,
        minVentPosition: 0,
        demandTolerance: asTempDelta(0.5),
        overshootTolerance: asTempDelta(0.5),
        calibratedTemp: asAbsoluteTemp(20),
      };
      const whileCallActive = computeDesiredPosition(
        base({ ...overshotInput, callActive: true }),
      );
      const whileGenuinelyIdle = computeDesiredPosition(
        base({ ...overshotInput, callActive: false }),
      );
      expect(whileCallActive.desiredPosition).toBeLessThan(100);
      expect(whileGenuinelyIdle.desiredPosition).toBe(100);
    });

    it("leaves the demanding branch completely unaffected by callActive: false", () => {
      const result = computeDesiredPosition(
        base({
          callActive: false,
          demanding: true,
          idleBaselinePosition: 0,
          demandTolerance: asTempDelta(0.5),
          overshootTolerance: asTempDelta(0.5),
          // deviation = 22-21 = 1, well past the demand tolerance — should
          // ramp open exactly as it would with callActive: true.
          calibratedTemp: asAbsoluteTemp(22),
        }),
      );
      expect(result.desiredPosition).toBeGreaterThan(0);
    });
  });
});
