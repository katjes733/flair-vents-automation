import { describe, it, expect } from "vitest";
import {
  resolveComfortTolerance,
  classifyZone,
} from "~/server/domain/targets/comfortTolerance";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";

describe("resolveComfortTolerance", () => {
  it("prefers the schedule override over the zone default", () => {
    expect(resolveComfortTolerance(asTempDelta(1), asTempDelta(2))).toBe(2);
  });

  it("falls back to the zone default when no override applies", () => {
    expect(resolveComfortTolerance(asTempDelta(1), null)).toBe(1);
  });

  it("is null when neither is configured — unset, not zero", () => {
    expect(resolveComfortTolerance(null, null)).toBeNull();
  });
});

describe("classifyZone", () => {
  const setpoint = asAbsoluteTemp(21);

  it("is unclassified regardless of deviation when there's no temperature sensor", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: false,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(30),
        resolvedSetpoint: setpoint,
        tolerance: null,
      }),
    ).toBe("unclassified_no_sensor");
  });

  it("treats unset tolerance as tight targeting (0)", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(21.1),
        resolvedSetpoint: setpoint,
        tolerance: null,
      }),
    ).toBe("demanding");
  });

  it("is satisfied exactly at the tolerance boundary, demanding just past it", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(22),
        resolvedSetpoint: setpoint,
        tolerance: asTempDelta(1),
      }),
    ).toBe("satisfied");
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(22.1),
        resolvedSetpoint: setpoint,
        tolerance: asTempDelta(1),
      }),
    ).toBe("demanding");
  });

  it("computes deviation in the correct direction for HEATING_CALL", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(19),
        resolvedSetpoint: setpoint,
        tolerance: null,
      }),
    ).toBe("demanding");
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(22),
        resolvedSetpoint: setpoint,
        tolerance: null,
      }),
    ).toBe("satisfied");
  });
});
