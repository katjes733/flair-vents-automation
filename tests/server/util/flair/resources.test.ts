import { describe, it, expect } from "vitest";
import { fetchAirHandlerSnapshot } from "~/server/util/flair/resources";
import { FakeFlairClient } from "../../../helpers/fakeFlairClient";

describe("fetchAirHandlerSnapshot", () => {
  it("scopes rooms/vents down to the given Flair zone (air handler), not the whole structure", () => {
    const client = new FakeFlairClient();
    client.setZones([
      {
        id: "zone-a",
        structureId: "s1",
        name: "Upstairs",
        thermostatId: "therm-a",
      },
      {
        id: "zone-b",
        structureId: "s1",
        name: "Downstairs",
        thermostatId: null,
      },
    ]);
    client.setThermostatState({
      thermostatId: "therm-a",
      operatingState: "cool",
      mode: "cool",
      ambientTemperatureC: 22,
      targetTemperatureC: 21,
      homeAway: "Home",
      fanState: null,
      online: true,
      written: false,
      writtenConfirmed: false,
      writtenFailures: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    client.setRooms([
      {
        id: "room-a",
        zoneId: "zone-a",
        structureId: "s1",
        name: "A",
        currentTemperatureC: 21,
        setpointC: null,
        active: true,
        hasVents: true,
        hasPucks: false,
        hasRemoteSensors: false,
      },
      {
        id: "room-b",
        zoneId: "zone-b",
        structureId: "s1",
        name: "B",
        currentTemperatureC: 20,
        setpointC: null,
        active: true,
        hasVents: true,
        hasPucks: false,
        hasRemoteSensors: false,
      },
    ]);
    client.setVents([
      {
        id: "vent-a",
        roomId: "room-a",
        percentOpen: 50,
        inactive: false,
        voltage: null,
        currentRssi: null,
      },
      {
        id: "vent-b",
        roomId: "room-b",
        percentOpen: 30,
        inactive: false,
        voltage: null,
        currentRssi: null,
      },
    ]);
    client.setVentReading({
      ventId: "vent-a",
      percentOpen: 50,
      ductTemperatureC: 15,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    client.setVentReading({
      ventId: "vent-b",
      percentOpen: 30,
      ductTemperatureC: 16,
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    return fetchAirHandlerSnapshot(client, "s1", "zone-a").then((snapshot) => {
      expect(snapshot.thermostatState?.thermostatId).toBe("therm-a");
      expect([...snapshot.roomsById.keys()]).toEqual(["room-a"]);
      expect([...snapshot.ventsById.keys()]).toEqual(["vent-a"]);
      expect(snapshot.ventReadingsByVentId.has("vent-b")).toBe(false);
    });
  });

  it("returns a null thermostatState when the zone has no thermostat", () => {
    const client = new FakeFlairClient();
    client.setZones([
      { id: "zone-a", structureId: "s1", name: "A", thermostatId: null },
    ]);
    client.setRooms([]);
    client.setVents([]);

    return fetchAirHandlerSnapshot(client, "s1", "zone-a").then((snapshot) => {
      expect(snapshot.thermostatState).toBeNull();
    });
  });
});
