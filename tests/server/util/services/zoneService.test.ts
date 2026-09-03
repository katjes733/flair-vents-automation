import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAirHandlerById } = vi.hoisted(() => ({
  getAirHandlerById: vi.fn(),
}));
vi.mock("~/server/util/routes/airHandler", () => ({ getAirHandlerById }));

const {
  createZone,
  updateZone,
  deleteZone,
  getZoneById,
  getZonesForInstallation,
} = vi.hoisted(() => ({
  createZone: vi.fn(),
  updateZone: vi.fn(),
  deleteZone: vi.fn(),
  getZoneById: vi.fn(),
  getZonesForInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/zone", () => ({
  createZone,
  updateZone,
  deleteZone,
  getZoneById,
  getZonesForInstallation,
}));

const { getSchedulesForInstallation } = vi.hoisted(() => ({
  getSchedulesForInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/schedule", () => ({
  getSchedulesForInstallation,
}));

const {
  createZoneForInstallation,
  updateZoneWithValidation,
  deleteZoneWithValidation,
} = await import("~/server/util/services/zoneService");

const BASE_CONFIG = {
  has_temperature_sensor: true,
  has_occupancy_sensor: false,
  thermal_load_flags: [],
  idle_baseline_position: 100,
  sensor_calibration_offset: 0,
  min_vent_position: 0,
  max_vent_position: 100,
  flair_vents: [{ flair_vent_id: "vent-1" }],
  manual_vents: [],
  display_order: 0,
};

describe("createZoneForInstallation", () => {
  beforeEach(() => {
    getAirHandlerById.mockReset();
    createZone.mockReset().mockResolvedValue({ id: "z1" });
    getZonesForInstallation.mockReset().mockResolvedValue([]);
  });

  it("rejects an air handler from a different installation", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "other-inst",
    });
    await expect(
      createZoneForInstallation({
        installationId: "inst-1",
        airHandlerId: "ah-1",
        flairRoomId: null,
        name: "Office",
        ventHardwareType: "flair_smart_vent",
        config: BASE_CONFIG,
      }),
    ).rejects.toThrow(/different installation/);
    expect(createZone).not.toHaveBeenCalled();
  });

  it("rejects a config validation error (e.g. min > max)", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "inst-1",
    });
    await expect(
      createZoneForInstallation({
        installationId: "inst-1",
        airHandlerId: "ah-1",
        flairRoomId: null,
        name: "Office",
        ventHardwareType: "flair_smart_vent",
        config: {
          ...BASE_CONFIG,
          min_vent_position: 80,
          max_vent_position: 20,
        },
      }),
    ).rejects.toThrow(/min_vent_position/);
  });

  it("creates the zone once validation passes", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "inst-1",
    });
    const zone = await createZoneForInstallation({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      flairRoomId: null,
      name: "Office",
      ventHardwareType: "flair_smart_vent",
      config: BASE_CONFIG,
    });
    expect(createZone).toHaveBeenCalledOnce();
    expect(zone).toEqual({ id: "z1" });
  });

  // Regression test: `zones.idx_zones_air_handler_name` is DB-unique, but
  // nothing at the service layer checked it before this — a duplicate
  // name on the same air handler fell straight through to a raw Postgres
  // "duplicate key value violates unique constraint" error surfaced
  // directly in the "Add zone" dialog. Confirmed live by the user.
  it("rejects a zone name already used on the same air handler", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "inst-1",
    });
    getZonesForInstallation.mockResolvedValue([
      {
        id: "z-existing",
        airHandlerId: "ah-1",
        name: "Luke Bathroom",
        config: BASE_CONFIG,
      },
    ]);
    await expect(
      createZoneForInstallation({
        installationId: "inst-1",
        airHandlerId: "ah-1",
        flairRoomId: null,
        name: "Luke Bathroom",
        ventHardwareType: "manual_fixed_vent",
        config: {
          ...BASE_CONFIG,
          flair_vents: [],
          manual_vents: [{ position: 25 }],
        },
      }),
    ).rejects.toThrow(/already exists on this air handler/);
    expect(createZone).not.toHaveBeenCalled();
  });

  it("allows the same zone name on a different air handler", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-2",
      installationId: "inst-1",
    });
    getZonesForInstallation.mockResolvedValue([
      {
        id: "z-existing",
        airHandlerId: "ah-1",
        name: "Luke Bathroom",
        config: BASE_CONFIG,
      },
    ]);
    const zone = await createZoneForInstallation({
      installationId: "inst-1",
      airHandlerId: "ah-2",
      flairRoomId: null,
      name: "Luke Bathroom",
      ventHardwareType: "flair_smart_vent",
      config: { ...BASE_CONFIG, flair_vents: [{ flair_vent_id: "vent-2" }] },
    });
    expect(createZone).toHaveBeenCalledOnce();
    expect(zone).toEqual({ id: "z1" });
  });

  // Regression coverage for "Multi-Vent Manual Zones" extending per-vent
  // duct ratings to flair_smart_vent zones: flair_vents moved from a flat
  // `string[]` to an array of `{flair_vent_id, duct_flow_rate_lps?}`
  // objects, and this conflict check has to keep working against the new
  // shape — a missed `.map()` here would silently stop detecting a vent id
  // already claimed by another zone.
  it("rejects a flair_vent_id already assigned to a different zone on the same installation", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "inst-1",
    });
    getZonesForInstallation.mockResolvedValue([
      {
        id: "z-existing",
        airHandlerId: "ah-1",
        name: "Bedroom",
        config: { ...BASE_CONFIG, flair_vents: [{ flair_vent_id: "vent-1" }] },
      },
    ]);
    await expect(
      createZoneForInstallation({
        installationId: "inst-1",
        airHandlerId: "ah-1",
        flairRoomId: null,
        name: "Office",
        ventHardwareType: "flair_smart_vent",
        config: { ...BASE_CONFIG, flair_vents: [{ flair_vent_id: "vent-1" }] },
      }),
    ).rejects.toThrow(/already assigned to zone/);
    expect(createZone).not.toHaveBeenCalled();
  });

  // Regression test: the sync engine's createZoneFromRoom (syncService.ts)
  // deliberately imports a zero-vent Flair room this way — a sensored
  // room with no vent is a real, sanctioned state (see the Zone Hardware
  // & Sensor Type Matrix's "sensored hallway with no vent" case), but
  // syncService.test.ts mocks this module entirely, so this exact
  // combination was never actually run through real config validation
  // until this test — which is how it shipped broken and was only caught
  // live, via the "Sync with Flair" dialog.
  it("allows creating a no_vent zone linked to a Flair room with no vents", async () => {
    getAirHandlerById.mockResolvedValue({
      id: "ah-1",
      installationId: "inst-1",
    });
    const zone = await createZoneForInstallation({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      flairRoomId: "room-1",
      name: "Den back",
      ventHardwareType: "no_vent",
      config: { ...BASE_CONFIG, flair_vents: [] },
    });
    expect(createZone).toHaveBeenCalledOnce();
    expect(zone).toEqual({ id: "z1" });
  });
});

describe("updateZoneWithValidation", () => {
  beforeEach(() => {
    getZoneById.mockReset();
    updateZone.mockReset().mockResolvedValue(undefined);
    getAirHandlerById.mockReset();
    getZonesForInstallation.mockReset().mockResolvedValue([]);
  });

  it("404s when the zone doesn't exist", async () => {
    getZoneById.mockResolvedValue(null);
    await expect(
      updateZoneWithValidation("missing", { name: "New" }),
    ).rejects.toThrow(/not found/);
  });

  it("merges config onto the existing row rather than replacing it", async () => {
    getZoneById
      .mockResolvedValueOnce({
        id: "z1",
        installationId: "inst-1",
        ventHardwareType: "flair_smart_vent",
        flairRoomId: null,
        config: BASE_CONFIG,
      })
      .mockResolvedValueOnce({ id: "z1", name: "Updated" });
    const result = await updateZoneWithValidation("z1", {
      config: { idle_baseline_position: 50 },
    });
    expect(updateZone).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        config: expect.objectContaining({
          idle_baseline_position: 50,
          has_temperature_sensor: true, // preserved from the existing row
        }),
      }),
    );
    expect(result).toEqual({ id: "z1", name: "Updated" });
  });

  it("rejects renaming a zone to a name already used on the same air handler", async () => {
    getZoneById.mockResolvedValue({
      id: "z1",
      installationId: "inst-1",
      airHandlerId: "ah-1",
      name: "Bedroom",
      ventHardwareType: "flair_smart_vent",
      flairRoomId: null,
      config: BASE_CONFIG,
    });
    getZonesForInstallation.mockResolvedValue([
      { id: "z1", airHandlerId: "ah-1", name: "Bedroom", config: BASE_CONFIG },
      {
        id: "z2",
        airHandlerId: "ah-1",
        name: "Luke Bathroom",
        config: { ...BASE_CONFIG, flair_vents: [{ flair_vent_id: "vent-2" }] },
      },
    ]);
    await expect(
      updateZoneWithValidation("z1", { name: "Luke Bathroom" }),
    ).rejects.toThrow(/already exists on this air handler/);
    expect(updateZone).not.toHaveBeenCalled();
  });

  it("allows re-saving a zone's own unchanged name", async () => {
    getZoneById
      .mockResolvedValueOnce({
        id: "z1",
        installationId: "inst-1",
        airHandlerId: "ah-1",
        name: "Bedroom",
        ventHardwareType: "flair_smart_vent",
        flairRoomId: null,
        config: BASE_CONFIG,
      })
      .mockResolvedValueOnce({ id: "z1", name: "Bedroom" });
    getZonesForInstallation.mockResolvedValue([
      { id: "z1", airHandlerId: "ah-1", name: "Bedroom", config: BASE_CONFIG },
    ]);
    await updateZoneWithValidation("z1", { name: "Bedroom" });
    expect(updateZone).toHaveBeenCalledOnce();
  });
});

describe("deleteZoneWithValidation", () => {
  beforeEach(() => {
    getZoneById.mockReset();
    deleteZone.mockReset().mockResolvedValue(undefined);
    getSchedulesForInstallation.mockReset();
  });

  it("404s when the zone doesn't exist", async () => {
    getZoneById.mockResolvedValue(null);
    await expect(deleteZoneWithValidation("missing")).rejects.toThrow(
      /not found/,
    );
  });

  it("refuses to delete a zone referenced by a schedule's zone_settings", async () => {
    getZoneById.mockResolvedValue({ id: "z1", installationId: "inst-1" });
    getSchedulesForInstallation.mockResolvedValue([
      {
        name: "Night",
        events: [{ zone_settings: [{ zone_id: "z1" }] }],
      },
    ]);
    await expect(deleteZoneWithValidation("z1")).rejects.toThrow(/Night/);
    expect(deleteZone).not.toHaveBeenCalled();
  });

  it("deletes cleanly when no schedule references it", async () => {
    getZoneById.mockResolvedValue({ id: "z1", installationId: "inst-1" });
    getSchedulesForInstallation.mockResolvedValue([]);
    await deleteZoneWithValidation("z1");
    expect(deleteZone).toHaveBeenCalledWith("z1");
  });
});
