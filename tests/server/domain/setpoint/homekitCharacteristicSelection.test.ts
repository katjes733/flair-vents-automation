import { describe, it, expect } from "vitest";
import { resolveHomeKitSetpointWrite } from "~/server/domain/setpoint/homekitCharacteristicSelection";

describe("resolveHomeKitSetpointWrite", () => {
  it("writes TargetTemperature when mode is Heat (1)", () => {
    expect(
      resolveHomeKitSetpointWrite({
        targetMode: 1,
        callState: "HEATING_CALL",
        pushedValueC: 20,
      }),
    ).toEqual({ kind: "target", value: 20 });
  });

  it("writes TargetTemperature when mode is Cool (2)", () => {
    expect(
      resolveHomeKitSetpointWrite({
        targetMode: 2,
        callState: "COOLING_CALL",
        pushedValueC: 24,
      }),
    ).toEqual({ kind: "target", value: 24 });
  });

  it("writes only CoolingThresholdTemperature when mode is Auto (3) and the call is cooling", () => {
    expect(
      resolveHomeKitSetpointWrite({
        targetMode: 3,
        callState: "COOLING_CALL",
        pushedValueC: 24,
      }),
    ).toEqual({ kind: "threshold", which: "cool", value: 24 });
  });

  it("writes only HeatingThresholdTemperature when mode is Auto (3) and the call is heating", () => {
    expect(
      resolveHomeKitSetpointWrite({
        targetMode: 3,
        callState: "HEATING_CALL",
        pushedValueC: 20,
      }),
    ).toEqual({ kind: "threshold", which: "heat", value: 20 });
  });

  it("writes nothing when mode is Off (0), regardless of call state", () => {
    expect(
      resolveHomeKitSetpointWrite({
        targetMode: 0,
        callState: "COOLING_CALL",
        pushedValueC: 24,
      }),
    ).toEqual({ kind: "skip", reason: "mode_off" });
  });

  it("never returns anything referencing TargetHeatingCoolingState — it is a read-only input", () => {
    // Structural guard: every branch's return shape is checked above and
    // none of them carry a "mode" field to write — this test exists as a
    // named regression marker for that property specifically, since it's
    // the single most important rule this function encodes.
    const result = resolveHomeKitSetpointWrite({
      targetMode: 3,
      callState: "COOLING_CALL",
      pushedValueC: 24,
    });
    expect(Object.keys(result)).not.toContain("targetMode");
    expect(Object.keys(result)).not.toContain("mode");
  });
});
