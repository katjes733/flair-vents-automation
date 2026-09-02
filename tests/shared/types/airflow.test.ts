import { describe, it, expect } from "vitest";
import { toDisplayFlowRate, fromDisplayFlowRate } from "~/shared/types/airflow";

describe("airflow conversions", () => {
  it("converts a stored L/s value to CFM", () => {
    // 708 L/s is Upstairs's real, sourced minimum-aggregate-flow floor
    // (Domain Research Directive) — 1500 CFM confirmed via Bosch's own
    // published CFM-vs-ESP tables, so this is a real, checkable figure,
    // not an arbitrary round-trip.
    expect(toDisplayFlowRate(708, "CFM")).toBeCloseTo(1500, 0);
  });

  it("passes a value through unchanged when the display unit is Lps", () => {
    expect(toDisplayFlowRate(47, "Lps")).toBe(47);
  });

  it("round-trips a CFM value back to L/s", () => {
    const lps = fromDisplayFlowRate(1500, "CFM");
    expect(lps).toBeCloseTo(708, 0);
    expect(toDisplayFlowRate(lps, "CFM")).toBeCloseTo(1500, 0);
  });

  it("converts a stored L/s value to m³/h", () => {
    expect(toDisplayFlowRate(1, "M3h")).toBeCloseTo(3.6, 2);
  });

  it("round-trips an m³/h value back to L/s", () => {
    const lps = fromDisplayFlowRate(3.6, "M3h");
    expect(lps).toBeCloseTo(1, 2);
  });
});
