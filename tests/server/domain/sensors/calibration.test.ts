import { describe, it, expect } from "vitest";
import { applyCalibration } from "~/server/domain/sensors/calibration";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";

describe("applyCalibration", () => {
  it("is a no-op at zero offset", () => {
    expect(applyCalibration(asAbsoluteTemp(21), asTempDelta(0))).toBe(21);
  });

  it("shifts by exactly the offset, in either direction", () => {
    expect(applyCalibration(asAbsoluteTemp(21), asTempDelta(1.5))).toBeCloseTo(
      22.5,
    );
    expect(applyCalibration(asAbsoluteTemp(21), asTempDelta(-1.5))).toBeCloseTo(
      19.5,
    );
  });
});
