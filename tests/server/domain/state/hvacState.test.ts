import { describe, it, expect } from "vitest";
import {
  deriveHvacState,
  deriveHvacStateViaHomeKit,
} from "~/server/domain/state/hvacState";

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

describe("deriveHvacStateViaHomeKit", () => {
  it("maps CurrentHeatingCoolingState Heat/Cool directly, regardless of fan state", () => {
    expect(deriveHvacStateViaHomeKit(1, 0)).toEqual({
      state: "HEATING_CALL",
      confidence: "reported",
    });
    expect(deriveHvacStateViaHomeKit(2, 1)).toEqual({
      state: "COOLING_CALL",
      confidence: "reported",
    });
  });

  it("distinguishes FAN_ONLY from IDLE via CurrentFanState when there's no active call", () => {
    expect(deriveHvacStateViaHomeKit(0, 2)).toEqual({
      state: "FAN_ONLY",
      confidence: "reported",
    });
    expect(deriveHvacStateViaHomeKit(0, 1)).toEqual({
      state: "IDLE",
      confidence: "reported",
    });
    expect(deriveHvacStateViaHomeKit(0, 0)).toEqual({
      state: "IDLE",
      confidence: "reported",
    });
  });

  it("is always 'reported' confidence — there's no unrecognized-value case for a typed HAP enum", () => {
    expect(deriveHvacStateViaHomeKit(0, 0).confidence).toBe("reported");
    expect(deriveHvacStateViaHomeKit(1, 2).confidence).toBe("reported");
  });
});
