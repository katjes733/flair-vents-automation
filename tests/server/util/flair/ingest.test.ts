import { describe, it, expect } from "vitest";
import {
  ingestZoneRoomReading,
  ingestZoneVentReading,
} from "~/server/util/flair/ingest";
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
    name: "Living Room Vent",
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

describe("ingestZoneRoomReading", () => {
  it("applies calibration exactly once, retaining the raw value only in diagnostics", () => {
    const result = ingestZoneRoomReading({
      zoneId: "z1",
      room: room({ currentTemperatureC: 21 }),
      occupancyReading: null,
      calibrationOffsetC: asTempDelta(1),
    });
    expect(result.calibratedTemp).toBeCloseTo(22, 5);
    expect(result.diagnostics.rawTemp).toBe(21);
  });

  it("handles a room with no temperature reading yet", () => {
    const result = ingestZoneRoomReading({
      zoneId: "z1",
      room: room({ currentTemperatureC: null }),
      occupancyReading: null,
      calibrationOffsetC: asTempDelta(2),
    });
    expect(result.calibratedTemp).toBeNull();
    expect(result.diagnostics.sensorValues).toEqual({});
  });

  it("passes through the live occupancy reading, distinguishing null (no sensor) from a real value", () => {
    const withSensor = ingestZoneRoomReading({
      zoneId: "z1",
      room: room(),
      occupancyReading: occupancyReading({ occupied: true }),
      calibrationOffsetC: asTempDelta(0),
    });
    expect(withSensor.occupiedRaw).toBe(true);

    const withoutSensor = ingestZoneRoomReading({
      zoneId: "z1",
      room: room(),
      occupancyReading: null,
      calibrationOffsetC: asTempDelta(0),
    });
    expect(withoutSensor.occupiedRaw).toBeNull();
  });
});

describe("ingestZoneVentReading", () => {
  it("passes through the vent's reported position, duct temperature, and name", () => {
    const result = ingestZoneVentReading({
      flairVentId: "vent-1",
      vent: vent({ percentOpen: 73, name: "Den Front" }),
      ventReading: ventReading({ ductTemperatureC: 12.5 }),
    });
    expect(result.reportedPositionPct).toBe(73);
    expect(result.ductTemperatureC).toBe(12.5);
    expect(result.name).toBe("Den Front");
  });

  it("handles a vent id with no vent/reading at all (not yet visible in this tick's snapshot)", () => {
    const result = ingestZoneVentReading({
      flairVentId: "vent-1",
      vent: null,
      ventReading: null,
    });
    expect(result.reportedPositionPct).toBeNull();
    expect(result.ductTemperatureC).toBeNull();
    expect(result.name).toBe("");
  });

  // See "Stage 12 — Current-Status Diagnostics" — these were already
  // fetched by FlairClient.fetchVents() on every tick but silently dropped
  // at this exact boundary until now.
  it("passes through the vent's battery voltage and RSSI for HardwareDiagnostics", () => {
    const result = ingestZoneVentReading({
      flairVentId: "vent-1",
      vent: vent({ voltage: 3.18, currentRssi: -69 }),
      ventReading: ventReading(),
    });
    expect(result.voltage).toBe(3.18);
    expect(result.currentRssi).toBe(-69);
  });

  it("reports null voltage/RSSI for a vent not yet visible in this tick's snapshot", () => {
    const result = ingestZoneVentReading({
      flairVentId: "vent-1",
      vent: null,
      ventReading: null,
    });
    expect(result.voltage).toBeNull();
    expect(result.currentRssi).toBeNull();
  });
});
