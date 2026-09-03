import { describe, it, expect } from "vitest";
import {
  isControllable,
  contributesToPressure,
  isSensored,
  isDrivingCandidate,
} from "~/server/domain/zone/predicates";

describe("isControllable", () => {
  it("is true only for flair_smart_vent", () => {
    expect(isControllable("flair_smart_vent")).toBe(true);
    expect(isControllable("manual_fixed_vent")).toBe(false);
    expect(isControllable("no_vent")).toBe(false);
  });
});

describe("contributesToPressure", () => {
  it("excludes no_vent only", () => {
    expect(contributesToPressure("flair_smart_vent")).toBe(true);
    expect(contributesToPressure("manual_fixed_vent")).toBe(true);
    expect(contributesToPressure("no_vent")).toBe(false);
  });
});

describe("isSensored", () => {
  it("mirrors the raw sensor flag", () => {
    expect(isSensored(true)).toBe(true);
    expect(isSensored(false)).toBe(false);
  });
});

describe("isDrivingCandidate", () => {
  it("requires sensored, not stale, and demanding all at once", () => {
    expect(
      isDrivingCandidate({
        hasTemperatureSensor: true,
        stale: false,
        demanding: true,
      }),
    ).toBe(true);
    expect(
      isDrivingCandidate({
        hasTemperatureSensor: false,
        stale: false,
        demanding: true,
      }),
    ).toBe(false);
    expect(
      isDrivingCandidate({
        hasTemperatureSensor: true,
        stale: true,
        demanding: true,
      }),
    ).toBe(false);
    expect(
      isDrivingCandidate({
        hasTemperatureSensor: true,
        stale: false,
        demanding: false,
      }),
    ).toBe(false);
  });
});
