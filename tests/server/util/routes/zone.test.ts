import { describe, it, expect, vi, beforeEach } from "vitest";

const { find, findOne, insert, update, deleteFn } = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  deleteFn: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({
    find,
    findOne,
    insert,
    update,
    delete: deleteFn,
  })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const {
  getZonesForAirHandler,
  getZonesForInstallation,
  getZoneById,
  createZone,
  updateZone,
  updateZoneState,
  deleteZone,
} = await import("~/server/util/routes/zone");

describe("getZonesForAirHandler", () => {
  beforeEach(() => {
    find.mockReset();
  });

  it("fills in default runtime state fields not yet present on an older row", async () => {
    find.mockResolvedValue([
      {
        id: "z1",
        installation_id: "inst-1",
        air_handler_id: "ah-1",
        flair_room_id: "room-1",
        name: "Bedroom",
        vent_hardware_type: "flair_smart_vent",
        config: {},
        state: { last_target_position: 42 },
      },
    ]);
    const [zone] = await getZonesForAirHandler("ah-1");
    expect(zone.state.last_target_position).toBe(42);
    expect(zone.state.vents).toEqual([]); // default filled in
  });
});

describe("updateZoneState", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue(undefined);
  });

  it("writes the given state and bumps modified_time", async () => {
    await updateZoneState("z1", {
      last_target_position: 50,
      last_commanded_at: null,
      vents: [],
      last_reading_value: null,
      last_reading_changed_at: null,
      stale: false,
      spike_active: false,
      spike_since: null,
      last_classification: null,
      classification_pending_value: null,
      classification_pending_since: null,
      occupied: false,
      occupancy_pending_flip_since: null,
    });
    expect(update).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        state: expect.objectContaining({ last_target_position: 50 }),
        modified_time: expect.any(Date),
      }),
    );
  });
});

describe("getZonesForInstallation", () => {
  it("queries by installation_id", async () => {
    find.mockReset().mockResolvedValue([]);
    await getZonesForInstallation("inst-1");
    expect(find).toHaveBeenCalledWith({
      where: { installation_id: "inst-1" },
    });
  });
});

describe("getZoneById", () => {
  beforeEach(() => {
    findOne.mockReset();
  });

  it("returns null when not found", async () => {
    findOne.mockResolvedValue(null);
    expect(await getZoneById("missing")).toBe(null);
  });

  it("resolves defaults for config/state on a found row", async () => {
    findOne.mockResolvedValue({
      id: "z1",
      installation_id: "inst-1",
      air_handler_id: "ah-1",
      flair_room_id: null,
      name: "Bedroom",
      vent_hardware_type: "flair_smart_vent",
      config: {},
      state: {},
    });
    const zone = await getZoneById("z1");
    expect(zone?.config.idle_baseline_position).toBe(100);
  });
});

describe("createZone", () => {
  beforeEach(() => {
    insert.mockReset().mockResolvedValue(undefined);
  });

  it("inserts a new row with fresh timestamps and empty runtime state", async () => {
    const zone = await createZone({
      installationId: "inst-1",
      airHandlerId: "ah-1",
      flairRoomId: null,
      name: "Office",
      ventHardwareType: "flair_smart_vent",
      config: { has_temperature_sensor: true } as never,
    });
    expect(insert).toHaveBeenCalledOnce();
    expect(zone.name).toBe("Office");
    expect(zone.state.vents).toEqual([]);
  });
});

describe("updateZone", () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue(undefined);
  });

  it("only writes fields that were actually passed", async () => {
    await updateZone("z1", { name: "New name" });
    expect(update).toHaveBeenCalledWith(
      "z1",
      expect.objectContaining({
        name: "New name",
        modified_time: expect.any(Date),
      }),
    );
    expect(update.mock.calls[0][1]).not.toHaveProperty("config");
  });
});

describe("deleteZone", () => {
  it("deletes by id", async () => {
    deleteFn.mockReset().mockResolvedValue(undefined);
    await deleteZone("z1");
    expect(deleteFn).toHaveBeenCalledWith("z1");
  });
});
