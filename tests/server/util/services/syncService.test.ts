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
          flair_vents: [{ flair_vent_id: "vent-1" }],
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
          flair_vents: [{ flair_vent_id: "vent-1" }],
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
        config: expect.objectContaining({ flair_vents: [] }),
      }),
    );
    expect(alerting.getSentKeys()).toContain("alert:hardwareRemoved:z1");
    expect(alerting.getSentSubjects()).toHaveLength(1);
  });

  // Regression coverage for extending per-vent duct ratings from manual
  // vents to flair_smart_vent zones (see "Multi-Vent Manual Zones"): a
  // re-sync that changes the live vent set must preserve a surviving
  // vent's already-configured rating, not silently wipe it just because
  // sync only ever learns a vent's identity from Flair, never its rating.
  it("preserves a surviving vent's own rating on matched_vent_set_changed, dropping only the vent that's gone", async () => {
    fetchSyncCandidates.mockResolvedValue([
      room({ liveVentIds: ["vent-1", "vent-3"] }),
    ]);
    getZonesForAirHandler.mockResolvedValue([
      {
        id: "z1",
        name: "Bedroom",
        flairRoomId: "room-1",
        ventHardwareType: "flair_smart_vent",
        config: {
          flair_vents: [
            { flair_vent_id: "vent-1", duct_flow_rate_lps: 40 },
            { flair_vent_id: "vent-2" },
          ],
          has_temperature_sensor: true,
          has_occupancy_sensor: false,
        },
      },
    ]);

    await runSync({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      structureId: "s1",
      flairZoneId: "fz1",
      client: fakeClient(),
      alerting: createInMemoryAlertingClient(),
      rateFloorMinutes: 15,
      nowMs: 1000,
    });

    expect(updateZoneWithValidation).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        config: expect.objectContaining({
          flair_vents: [
            { flair_vent_id: "vent-1", duct_flow_rate_lps: 40 },
            { flair_vent_id: "vent-3" },
          ],
        }),
      }),
    );
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

  // Regression coverage for the reversed import default: a real
  // house confirmed that a Flair room reporting zero live vents
  // overwhelmingly still has a real, manually-actuated vent — Flair
  // just doesn't track it — so this now resolves to manual_fixed_vent,
  // not no_vent, with the caller-supplied fixed position threaded
  // through (never guessed here).
  it("links as manual_fixed_vent (a single vent at the given fixed position) when the room has no live vents", async () => {
    await linkRoomToZone({
      zoneId: "z1",
      room: room({ liveVentIds: [] }),
      assumedFixedPosition: 30,
    });
    const patch = updateZoneWithValidation.mock.calls[0][1];
    expect(patch.ventHardwareType).toBe("manual_fixed_vent");
    expect(patch.config.manual_vents).toEqual([{ position: 30 }]);
    // flair_room_id stays linked either way — it only ever anchors
    // sensor data, independent of the vent's own hardware.
    expect(patch.flairRoomId).toBe("room-1");
  });

  it("clears a stale manual_vents when linking converts a zone to flair_smart_vent", async () => {
    await linkRoomToZone({ zoneId: "z1", room: room() });
    const patch = updateZoneWithValidation.mock.calls[0][1];
    expect(patch.ventHardwareType).toBe("flair_smart_vent");
    expect(patch.config.manual_vents).toEqual([]);
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

  // Regression coverage for the reversed import default — see
  // linkRoomToZone's own identical case above for the full reasoning.
  it("defaults hardware type to manual_fixed_vent for a vent-less room, using the given fixed position", async () => {
    await createZoneFromRoom({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      room: room({ liveVentIds: [] }),
      assumedFixedPosition: 40,
    });
    expect(createZoneForInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        ventHardwareType: "manual_fixed_vent",
        config: expect.objectContaining({
          manual_vents: [{ position: 40 }],
        }),
      }),
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
