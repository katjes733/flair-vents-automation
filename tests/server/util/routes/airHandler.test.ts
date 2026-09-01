import { describe, it, expect, vi, beforeEach } from "vitest";

const { find, findOne, insert, update } = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ find, findOne, insert, update })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const {
  getActiveAirHandlers,
  getAirHandlerById,
  getAirHandlersForInstallation,
  createAirHandler,
  updateAirHandler,
} = await import("~/server/util/routes/airHandler");

describe("getActiveAirHandlers", () => {
  beforeEach(() => {
    find.mockReset();
  });

  it("resolves config and maps snake_case columns to camelCase", async () => {
    find.mockResolvedValue([
      {
        id: "ah-1",
        installation_id: "inst-1",
        flair_zone_id: "flair-zone-1",
        name: "Upstairs",
        active: true,
        config: { tonnage_tons: 5 },
      },
    ]);
    const result = await getActiveAirHandlers("inst-1");
    expect(result).toEqual([
      {
        id: "ah-1",
        installationId: "inst-1",
        flairZoneId: "flair-zone-1",
        name: "Upstairs",
        active: true,
        config: expect.objectContaining({
          tonnage_tons: 5,
          topology_mode: "variable_speed",
        }),
      },
    ]);
    expect(find).toHaveBeenCalledWith({
      where: { installation_id: "inst-1", active: true },
    });
  });
});

describe("getAirHandlerById", () => {
  beforeEach(() => {
    findOne.mockReset();
  });

  it("returns null when not found", async () => {
    findOne.mockResolvedValue(null);
    expect(await getAirHandlerById("missing")).toBeNull();
  });
});

describe("getAirHandlersForInstallation", () => {
  it("queries by installation_id, active and inactive alike", async () => {
    find.mockReset().mockResolvedValue([]);
    await getAirHandlersForInstallation("inst-1");
    expect(find).toHaveBeenCalledWith({
      where: { installation_id: "inst-1" },
    });
  });
});

describe("createAirHandler", () => {
  it("inserts a new row with fresh timestamps", async () => {
    insert.mockReset().mockResolvedValue(undefined);
    const airHandler = await createAirHandler({
      installationId: "inst-1",
      flairZoneId: null,
      name: "Downstairs",
      active: false,
      config: { topology_mode: "variable_speed" } as never,
    });
    expect(insert).toHaveBeenCalledOnce();
    expect(airHandler.name).toBe("Downstairs");
  });
});

describe("updateAirHandler", () => {
  it("only writes fields that were actually passed", async () => {
    update.mockReset().mockResolvedValue(undefined);
    await updateAirHandler("ah-1", { active: true });
    expect(update).toHaveBeenCalledWith(
      "ah-1",
      expect.objectContaining({
        active: true,
        modified_time: expect.any(Date),
      }),
    );
    expect(update.mock.calls[0][1]).not.toHaveProperty("name");
  });
});
