import { describe, it, expect } from "vitest";
import {
  resolveAwaySource,
  applyAwayTargets,
} from "~/server/domain/targets/awayMode";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";

describe("resolveAwaySource", () => {
  it("is the union of Ecobee-sourced and native away sets", () => {
    const source = {
      ecobeeAwayZoneIds: new Set(["z1"]),
      nativeAwayZoneIds: new Set(["z2"]),
    };
    expect(resolveAwaySource("z1", source)).toBe(true);
    expect(resolveAwaySource("z2", source)).toBe(true);
    expect(resolveAwaySource("z3", source)).toBe(false);
  });
});

describe("applyAwayTargets", () => {
  it("selects cool/heat setpoint by call state, always with the away tolerance", () => {
    const params = {
      awaySetpointCool: asAbsoluteTemp(27.78),
      awaySetpointHeat: asAbsoluteTemp(15.56),
      awayTolerance: asTempDelta(2.78),
    };
    expect(applyAwayTargets({ ...params, state: "COOLING_CALL" })).toEqual({
      setpoint: 27.78,
      tolerance: 2.78,
    });
    expect(applyAwayTargets({ ...params, state: "HEATING_CALL" })).toEqual({
      setpoint: 15.56,
      tolerance: 2.78,
    });
  });
});
