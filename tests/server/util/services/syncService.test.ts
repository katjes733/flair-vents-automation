import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInMemoryAlertingClient } from "~/server/util/alerting";
import type { SyncCandidateRoom } from "~/server/util/flair/resources";

const { fetchSyncCandidates } = vi.hoisted(() => ({
  fetchSyncCandidates: vi.fn(),
}));
vi.mock("~/server/util/flair/resources", () => ({ fetchSyncCandidates }));

const { getZonesForAirHandler } = vi.hoisted(() => ({
  getZonesForAirHandler: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({ getZonesForAirHandler }));

const { createZoneForInstallation, updateZoneWithValidation } = vi.hoisted(
  () => ({
    createZoneForInstallation: vi.fn(),
    updateZoneWithValidation: vi.fn(),
  }),
);
vi.mock("~/server/util/services/zoneService", () => ({
  createZoneForInstallation,
  updateZoneWithValidation,
}));

const { runSync, linkRoomToZone, createZoneFromRoom } =
  await import("~/server/util/services/syncService");

function fakeClient() {
  return {} as never;
}

function room(overrides: Partial<SyncCandidateRoom> = {}): SyncCandidateRoom {
  return {
    flairRoomId: "room-1",
    name: "Bedroom",
    liveVentIds: ["vent-1"],
    hasTemperatureSensor: true,
    hasOccupancySensor: false,
    ...overrides,
  };
}

describe("runSync", () => {
  beforeEach(() => {
    fetchSyncCandidates.mockReset();
    getZonesForAirHandler.mockReset();
    createZoneForInstallation.mockReset();
    updateZoneWithValidation.mockReset().mockResolvedValue({});
  });

  it("applies a matched_sensor_drift entry via updateZoneWithValidation, touching only config", async () => {
    fetchSyncCandidates.mockResolvedValue([room({ hasOccupancySensor: true })]);
    getZonesForAirHandler.mockResolvedValue([
      {
        id: "z1",
        name: "Bedroom",
        flairRoomId: "room-1",
        ventHardwareType: "flair_smart_vent",
        config: {
          flair_vent_ids: ["vent-1"],
          has_temperature_sensor: true,
          has_occupancy_sensor: false,
        },
      },
    ]);
    const alerting = createInMemoryAlertingClient();

    const result = await runSync({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      structureId: "s1",
      flairZoneId: "fz1",
      client: fakeClient(),
      alerting,
      rateFloorMinutes: 15,
      nowMs: 1000,
    });

    expect(updateZoneWithValidation).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        config: expect.objectContaining({ has_occupancy_sensor: true }),
      }),
    );
    expect(updateZoneWithValidation.mock.calls[0][1]).not.toHaveProperty(
      "name",
    );
    expect(result.applied).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
  });

  it("fires the hardware-removed alert exactly once when total vent loss is detected", async () => {
    fetchSyncCandidates.mockResolvedValue([room({ liveVentIds: [] })]);
    getZonesForAirHandler.mockResolvedValue([
      {
        id: "z1",
        name: "Bedroom",
        flairRoomId: "room-1",
        ventHardwareType: "flair_smart_vent",
        config: {
          flair_vent_ids: ["vent-1"],
          has_temperature_sensor: true,
          has_occupancy_sensor: false,
        },
      },
    ]);
    const alerting = createInMemoryAlertingClient();

    await runSync({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      structureId: "s1",
      flairZoneId: "fz1",
      client: fakeClient(),
      alerting,
      rateFloorMinutes: 15,
      nowMs: 1000,
    });

    expect(updateZoneWithValidation).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        ventHardwareType: "no_vent",
        config: expect.objectContaining({ flair_vent_ids: [] }),
      }),
    );
    expect(alerting.getSentKeys()).toContain("alert:hardwareRemoved:z1");
    expect(alerting.getSentSubjects()).toHaveLength(1);
  });

  it("returns unmatched rooms without touching the DB", async () => {
    fetchSyncCandidates.mockResolvedValue([
      room({ flairRoomId: "room-2", name: "Garage" }),
    ]);
    getZonesForAirHandler.mockResolvedValue([]);

    const result = await runSync({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      structureId: "s1",
      flairZoneId: "fz1",
      client: fakeClient(),
      alerting: createInMemoryAlertingClient(),
      rateFloorMinutes: 15,
      nowMs: 1000,
    });

    expect(updateZoneWithValidation).not.toHaveBeenCalled();
    expect(createZoneForInstallation).not.toHaveBeenCalled();
    expect(result.unmatched).toEqual([
      expect.objectContaining({ kind: "unmatched_new", name: "Garage" }),
    ]);
  });
});

describe("linkRoomToZone", () => {
  beforeEach(() => {
    updateZoneWithValidation.mockReset().mockResolvedValue({});
  });

  it("preserves name/schedules — the patch never includes name", async () => {
    await linkRoomToZone({ zoneId: "z1", room: room() });
    const patch = updateZoneWithValidation.mock.calls[0][1];
    expect(patch).not.toHaveProperty("name");
    expect(patch.flairRoomId).toBe("room-1");
    expect(patch.ventHardwareType).toBe("flair_smart_vent");
  });

  it("links as no_vent when the room has no live vents", async () => {
    await linkRoomToZone({ zoneId: "z1", room: room({ liveVentIds: [] }) });
    const patch = updateZoneWithValidation.mock.calls[0][1];
    expect(patch.ventHardwareType).toBe("no_vent");
  });
});

describe("createZoneFromRoom", () => {
  beforeEach(() => {
    createZoneForInstallation.mockReset().mockResolvedValue({});
  });

  it("defaults hardware type to flair_smart_vent for a vent-having room", async () => {
    await createZoneFromRoom({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      room: room(),
    });
    expect(createZoneForInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        ventHardwareType: "flair_smart_vent",
        name: "Bedroom",
      }),
    );
  });

  it("defaults hardware type to no_vent for a sensor-only room", async () => {
    await createZoneFromRoom({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      room: room({ liveVentIds: [] }),
    });
    expect(createZoneForInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ ventHardwareType: "no_vent" }),
    );
  });

  it("uses the provided name override instead of the room's own name", async () => {
    await createZoneFromRoom({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      room: room(),
      name: "Guest Room",
    });
    expect(createZoneForInstallation).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Guest Room" }),
    );
  });
});
