import type {
  FlairClient,
  FlairRoom,
  FlairVent,
  FlairVentReading,
  FlairThermostatState,
  FlairRemoteSensorReading,
} from "~/server/util/flair/client";

export interface AirHandlerSnapshot {
  thermostatState: FlairThermostatState | null;
  roomsById: Map<string, FlairRoom>;
  ventsByRoomId: Map<string, FlairVent>;
  ventReadingsByVentId: Map<string, FlairVentReading>;
  // Occupancy lives on the remote-sensor's own reading sub-resource, not
  // on the room — see FlairRemoteSensorReading. `is-tstat` sensors are
  // excluded: a room's occupancy should reflect its own SmartSensor, not
  // wherever the thermostat itself physically is.
  occupancyReadingByRoomId: Map<string, FlairRemoteSensorReading>;
}

/**
 * Fetches everything one air handler's tick needs in one place. A Flair
 * "zone" is this app's "air handler" concept (see docs/flair-api-schema.md)
 * — `fetchRooms`/`fetchVents` are structure-scoped in Flair's own API, so
 * this filters down to the rooms actually belonging to `flairZoneId` (and
 * the vents belonging to those rooms) rather than the whole house.
 */
export async function fetchAirHandlerSnapshot(
  client: FlairClient,
  structureId: string,
  flairZoneId: string,
): Promise<AirHandlerSnapshot> {
  const zones = await client.fetchZones(structureId);
  const zone = zones.find((z) => z.id === flairZoneId);
  const thermostatState = zone?.thermostatId
    ? await client.fetchThermostatState(zone.thermostatId)
    : null;

  const allRooms = await client.fetchRooms(structureId);
  const rooms = allRooms.filter((r) => r.zoneId === flairZoneId);
  const roomIds = new Set(rooms.map((r) => r.id));

  const allVents = await client.fetchVents(structureId);
  const vents = allVents.filter((v) => roomIds.has(v.roomId));

  const ventReadings = await Promise.all(
    vents.map((v) => client.fetchVentReading(v.id)),
  );

  const allRemoteSensors = await client.fetchRemoteSensors(structureId);
  const roomSensors = allRemoteSensors.filter(
    (s) => !s.isTstat && s.roomId !== null && roomIds.has(s.roomId),
  );
  const occupancyReadings = await Promise.all(
    roomSensors.map((s) => client.fetchRemoteSensorReading(s.id)),
  );
  const occupancyReadingByRoomId = new Map<string, FlairRemoteSensorReading>();
  roomSensors.forEach((sensor, i) => {
    if (sensor.roomId)
      occupancyReadingByRoomId.set(sensor.roomId, occupancyReadings[i]);
  });

  return {
    thermostatState,
    roomsById: new Map(rooms.map((r) => [r.id, r])),
    ventsByRoomId: new Map(vents.map((v) => [v.roomId, v])),
    ventReadingsByVentId: new Map(ventReadings.map((r) => [r.ventId, r])),
    occupancyReadingByRoomId,
  };
}
