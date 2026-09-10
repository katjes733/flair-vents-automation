import { describe, it, expect } from "vitest";
import {
  computeSensorMatches,
  type SensorMatchZoneInput,
} from "~/server/util/homekit/sensorMatch";
import type { HomeKitSensorReading } from "~/server/util/homekit/client";

function sensor(
  overrides: Partial<HomeKitSensorReading> = {},
): HomeKitSensorReading {
  return {
    serial: "Y3H2",
    name: "Martin Office",
    tempC: 22,
    occupied: false,
    motion: false,
    ...overrides,
  };
}

function zone(
  overrides: Partial<SensorMatchZoneInput> = {},
): SensorMatchZoneInput {
  return {
    id: "z1",
    name: "Martin Office",
    homekitSensorSerial: null,
    ...overrides,
  };
}

describe("computeSensorMatches", () => {
  it("reports already_mapped for a sensor whose serial is already mapped to a zone", () => {
    const [entry] = computeSensorMatches(
      [sensor({ serial: "Y3H2" })],
      [zone({ id: "z1", name: "Martin Office", homekitSensorSerial: "Y3H2" })],
    );
    expect(entry).toEqual({
      kind: "already_mapped",
      serial: "Y3H2",
      name: "Martin Office",
      tempC: 22,
      occupied: false,
      zoneId: "z1",
      zoneName: "Martin Office",
    });
  });

  it("suggests an unmapped zone whose name matches the sensor's own name, case-insensitively", () => {
    const [entry] = computeSensorMatches(
      [sensor({ serial: "Y22S", name: "martin bedroom" })],
      [zone({ id: "z2", name: "Martin Bedroom", homekitSensorSerial: null })],
    );
    expect(entry).toMatchObject({
      kind: "unmapped_suggested",
      suggestedZoneId: "z2",
      suggestedZoneName: "Martin Bedroom",
    });
  });

  it("reports unmapped_new when no unmapped zone's name matches — the real 'Extra Den' case", () => {
    const [entry] = computeSensorMatches(
      [sensor({ serial: "TB7M", name: "Extra Den" })],
      [
        zone({ id: "z3", name: "Den Front", homekitSensorSerial: null }),
        zone({ id: "z4", name: "Den back", homekitSensorSerial: null }),
      ],
    );
    expect(entry).toMatchObject({ kind: "unmapped_new" });
  });

  it("never suggests a zone that's already mapped to a different serial", () => {
    const [entry] = computeSensorMatches(
      [sensor({ serial: "NEW1", name: "Martin Office" })],
      [
        zone({
          id: "z1",
          name: "Martin Office",
          homekitSensorSerial: "Y3H2", // already mapped to a different sensor
        }),
      ],
    );
    expect(entry).toMatchObject({ kind: "unmapped_new" });
  });

  it("reports unmapped_new for a sensor with no Name characteristic at all", () => {
    const [entry] = computeSensorMatches(
      [sensor({ serial: "Y3H2", name: undefined })],
      [zone({ id: "z1", name: "Martin Office", homekitSensorSerial: null })],
    );
    expect(entry).toMatchObject({ kind: "unmapped_new", name: "" });
  });
});
