import { describe, it, expect } from "vitest";
import {
  niceTickInterval,
  tickDecimalsForInterval,
} from "~/client/components/shared/charts/chartMath";

describe("niceTickInterval", () => {
  it("picks a whole-number interval for a wide range", () => {
    expect(niceTickInterval(0, 100)).toBe(20);
  });

  it("picks a sub-1 interval for a narrow range", () => {
    // Range 71-75 alone would round to 1, but a narrower real range (the
    // exact shape that produced the reported bug) rounds to 0.5.
    expect(niceTickInterval(71.8, 74.3)).toBe(0.5);
  });
});

describe("tickDecimalsForInterval", () => {
  it("needs no decimals for a whole-number-or-coarser interval", () => {
    expect(tickDecimalsForInterval(1)).toBe(0);
    expect(tickDecimalsForInterval(2)).toBe(0);
    expect(tickDecimalsForInterval(5)).toBe(0);
    expect(tickDecimalsForInterval(20)).toBe(0);
  });

  // Regression case for the reported bug: a real 0.5° tick interval
  // rendered every tick rounded to a whole degree ("75°F, 74°F, 74°F,
  // 73°F..."), making adjacent ticks indistinguishable.
  it("needs one decimal for a 0.5, 0.2, or 0.1 interval", () => {
    expect(tickDecimalsForInterval(0.5)).toBe(1);
    expect(tickDecimalsForInterval(0.2)).toBe(1);
    expect(tickDecimalsForInterval(0.1)).toBe(1);
  });

  it("needs two decimals for a 0.05 or 0.02 interval — one decimal alone isn't enough", () => {
    expect(tickDecimalsForInterval(0.05)).toBe(2);
    expect(tickDecimalsForInterval(0.02)).toBe(2);
  });

  it("treats a zero or negative interval as needing no decimals, rather than throwing", () => {
    expect(tickDecimalsForInterval(0)).toBe(0);
    expect(tickDecimalsForInterval(-1)).toBe(0);
  });
});
