import { describe, it, expect } from "vitest";
import { ingestZoneReading } from "~/server/util/flair/ingest";
import { asTempDelta } from "~/shared/types/temperature";
import type {
  FlairRoom,
  FlairVent,
  FlairVentReading,
  FlairRemoteSensorReading,
} from "~/server/util/flair/client";

function room(overrides: Partial<FlairRoom> = {}): FlairRoom {
  return {
    id: "room-1",
    zoneId: "zone-1",
    structureId: "structure-1",
    name: "Living Room",
    currentTemperatureC: 21,
    setpointC: null,
    active: true,
    hasVents: true,
    hasPucks: false,
    hasRemoteSensors: false,
    ...overrides,
  };
}

function vent(overrides: Partial<FlairVent> = {}): FlairVent {
  return {
    id: "vent-1",
    roomId: "room-1",
    percentOpen: 50,
    inactive: false,
    voltage: null,
    currentRssi: null,
    ...overrides,
  };
}

function ventReading(
  overrides: Partial<FlairVentReading> = {},
): FlairVentReading {
  return {
    ventId: "vent-1",
    percentOpen: 50,
    ductTemperatureC: 15,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function occupancyReading(
  overrides: Partial<FlairRemoteSensorReading> = {},
): FlairRemoteSensorReading {
  return {
    remoteSensorId: "sensor-1",
    occupied: true,
    temperatureC: 21,
    humidity: 45,
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ingestZoneReading", () => {
  it("applies calibration exactly once, retaining the raw value only in diagnostics", () => {
    const result = ingestZoneReading({
      zoneId: "z1",
      room: room({ currentTemperatureC: 21 }),
      vent: vent(),
      ventReading: ventReading(),
      occupancyReading: null,
      calibrationOffsetC: asTempDelta(1),
    });
    expect(result.calibratedTemp).toBeCloseTo(22, 5);
    expect(result.diagnostics.rawTemp).toBe(21);
  });

  it("passes through the vent's reported position and duct temperature", () => {
    const result = ingestZoneReading({
      zoneId: "z1",
      room: room(),
      vent: vent({ percentOpen: 73 }),
      ventReading: ventReading({ ductTemperatureC: 12.5 }),
      occupancyReading: null,
      calibrationOffsetC: asTempDelta(0),
    });
    expect(result.reportedPositionPct).toBe(73);
    expect(result.ductTemperatureC).toBe(12.5);
  });

  it("handles a zone with no vent/reading at all (manual_fixed_vent / no_vent)", () => {
    const result = ingestZoneReading({
      zoneId: "z1",
      room: room(),
      vent: null,
      ventReading: null,
      occupancyReading: null,
      calibrationOffsetC: asTempDelta(0),
    });
    expect(result.reportedPositionPct).toBeNull();
    expect(result.ductTemperatureC).toBeNull();
  });

  it("handles a room with no temperature reading yet", () => {
    const result = ingestZoneReading({
      zoneId: "z1",
      room: room({ currentTemperatureC: null }),
      vent: null,
      ventReading: null,
      occupancyReading: null,
      calibrationOffsetC: asTempDelta(2),
    });
    expect(result.calibratedTemp).toBeNull();
    expect(result.diagnostics.sensorValues).toEqual({});
  });

  it("passes through the live occupancy reading, distinguishing null (no sensor) from a real value", () => {
    const withSensor = ingestZoneReading({
      zoneId: "z1",
      room: room(),
      vent: null,
      ventReading: null,
      occupancyReading: occupancyReading({ occupied: true }),
      calibrationOffsetC: asTempDelta(0),
    });
    expect(withSensor.occupiedRaw).toBe(true);

    const withoutSensor = ingestZoneReading({
      zoneId: "z1",
      room: room(),
      vent: null,
      ventReading: null,
      occupancyReading: null,
      calibrationOffsetC: asTempDelta(0),
    });
    expect(withoutSensor.occupiedRaw).toBeNull();
  });
});
