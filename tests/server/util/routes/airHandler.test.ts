import { describe, it, expect, vi, beforeEach } from "vitest";

const { find, findOne } = vi.hoisted(() => ({
  find: vi.fn(),
  findOne: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ find, findOne })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { getActiveAirHandlers, getAirHandlerById } =
  await import("~/server/util/routes/airHandler");

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
