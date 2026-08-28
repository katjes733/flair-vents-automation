import { describe, it, expect } from "vitest";
import { smoothOffset } from "~/server/domain/setpoint/offsetSmoothing";

describe("smoothOffset", () => {
  it("converges toward the raw offset over repeated calls", () => {
    let smoothed = 0;
    for (let i = 0; i < 20; i++) {
      smoothed = smoothOffset({
        previousSmoothedOffset: smoothed,
        rawOffset: 2,
        alpha: 0.3,
        maxAbsOffsetC: 5,
      });
    }
    expect(smoothed).toBeCloseTo(2, 1);
  });

  it("clamps beyond the configured max", () => {
    const smoothed = smoothOffset({
      previousSmoothedOffset: 4.9,
      rawOffset: 10,
      alpha: 1,
      maxAbsOffsetC: 5,
    });
    expect(smoothed).toBe(5);
  });

  it("applies the same formula regardless of why the input changed (no special-cased snap)", () => {
    // A tracked-zone switch just looks like any other change in rawOffset —
    // same smoothing formula applies, no discontinuity.
    const afterNormalChange = smoothOffset({
      previousSmoothedOffset: 0,
      rawOffset: 3,
      alpha: 0.3,
      maxAbsOffsetC: 5,
    });
    const afterSimulatedZoneSwitch = smoothOffset({
      previousSmoothedOffset: 0,
      rawOffset: 3,
      alpha: 0.3,
      maxAbsOffsetC: 5,
    });
    expect(afterSimulatedZoneSwitch).toBe(afterNormalChange);
  });
});
