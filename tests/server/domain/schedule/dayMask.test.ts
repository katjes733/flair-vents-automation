import { describe, it, expect } from "vitest";
import {
  dayBit,
  maskIncludesDay,
  bitCount,
} from "~/server/domain/schedule/dayMask";

describe("dayBit / maskIncludesDay", () => {
  it("bit 0 is Sunday, bit 6 is Saturday", () => {
    expect(dayBit(0)).toBe(0b1);
    expect(dayBit(6)).toBe(0b1000000);
  });

  it("detects membership in a mask", () => {
    const mondayWednesdayFriday = dayBit(1) | dayBit(3) | dayBit(5);
    expect(maskIncludesDay(mondayWednesdayFriday, 1)).toBe(true);
    expect(maskIncludesDay(mondayWednesdayFriday, 2)).toBe(false);
  });
});

describe("bitCount", () => {
  it("counts set days for the specificity tiebreak", () => {
    expect(bitCount(0)).toBe(0);
    expect(bitCount(dayBit(1))).toBe(1);
    expect(bitCount(0b1111111)).toBe(7);
  });
});
