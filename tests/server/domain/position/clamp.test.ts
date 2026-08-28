import { describe, it, expect } from "vitest";
import {
  clampToZoneRange,
  quantizeToStep,
  clampQuantizeClamp,
} from "~/server/domain/position/clamp";

describe("clampToZoneRange", () => {
  it("clamps into [min,max]", () => {
    expect(clampToZoneRange(150, 0, 100)).toBe(100);
    expect(clampToZoneRange(-10, 0, 100)).toBe(0);
    expect(clampToZoneRange(50, 0, 100)).toBe(50);
  });
});

describe("quantizeToStep", () => {
  it("rounds to the nearest step", () => {
    expect(quantizeToStep(47, 10)).toBe(50);
    expect(quantizeToStep(44, 10)).toBe(40);
  });

  it("is a no-op for a non-positive step", () => {
    expect(quantizeToStep(47, 0)).toBe(47);
    expect(quantizeToStep(47, -5)).toBe(47);
  });
});

describe("clampQuantizeClamp", () => {
  it("re-clamps after quantization breaches the boundary (the plan's own 47%/10% example)", () => {
    expect(clampQuantizeClamp(47, { min: 0, max: 47 }, 10)).toBe(47);
  });

  it("clamps before quantizing too", () => {
    expect(clampQuantizeClamp(150, { min: 0, max: 100 }, 10)).toBe(100);
  });

  it("quantizes a mid-range value normally", () => {
    expect(clampQuantizeClamp(44, { min: 0, max: 100 }, 10)).toBe(40);
  });
});
