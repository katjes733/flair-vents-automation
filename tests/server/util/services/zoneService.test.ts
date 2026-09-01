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
  flair_vent_ids: ["vent-1"],
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
