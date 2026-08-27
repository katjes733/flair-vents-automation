import { describe, it, expect } from "vitest";
import {
  asAbsoluteTemp,
  asTempDelta,
  toDisplayAbsolute,
  fromDisplayAbsolute,
  toDisplayDelta,
  fromDisplayDelta,
} from "~/shared/types/temperature";

describe("temperature conversions", () => {
  it("converts an absolute Celsius value to Fahrenheit using the full formula", () => {
    expect(toDisplayAbsolute(asAbsoluteTemp(0), "F")).toBeCloseTo(32);
    expect(toDisplayAbsolute(asAbsoluteTemp(100), "F")).toBeCloseTo(212);
  });

  it("passes an absolute Celsius value through unchanged when the display unit is C", () => {
    expect(toDisplayAbsolute(asAbsoluteTemp(21.5), "C")).toBe(21.5);
  });

  it("round-trips an absolute Fahrenheit value back to Celsius", () => {
    const celsius = fromDisplayAbsolute(72, "F");
    expect(celsius).toBeCloseTo(22.222, 2);
    expect(toDisplayAbsolute(celsius, "F")).toBeCloseTo(72);
  });

  it("converts a delta using only the scale factor, never the ±32 offset", () => {
    // A 3°F band width must become ~1.67°C, NOT the absolute-temperature
    // formula's nonsensical ~ -16°C — this is the exact mistake the
    // implementation plan calls out as a real, silent-bug-shaped risk.
    const delta = fromDisplayDelta(3, "F");
    expect(delta).toBeCloseTo(1.667, 2);
    expect(toDisplayDelta(delta, "F")).toBeCloseTo(3);
  });

  it("passes a delta through unchanged when the display unit is C", () => {
    expect(toDisplayDelta(asTempDelta(1.11), "C")).toBe(1.11);
  });
});
