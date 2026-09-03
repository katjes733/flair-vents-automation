import { describe, it, expect } from "vitest";
import { deriveHvacState } from "~/server/domain/state/hvacState";

describe("deriveHvacState", () => {
  it("maps confirmed Flair operating-state values", () => {
    expect(deriveHvacState("cool")).toEqual({
      state: "COOLING_CALL",
      confidence: "reported",
    });
    expect(deriveHvacState("heat")).toEqual({
      state: "HEATING_CALL",
      confidence: "reported",
    });
    expect(deriveHvacState("fan")).toEqual({
      state: "FAN_ONLY",
      confidence: "reported",
    });
    expect(deriveHvacState("idle")).toEqual({
      state: "IDLE",
      confidence: "reported",
    });
  });

  it("never infers state from anything but the raw value — unknown/missing yields unknown confidence", () => {
    expect(deriveHvacState(null)).toEqual({
      state: "IDLE",
      confidence: "unknown",
    });
    expect(deriveHvacState("some-unrecognized-value")).toEqual({
      state: "IDLE",
      confidence: "unknown",
    });
  });
});
