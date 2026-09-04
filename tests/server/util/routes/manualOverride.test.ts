import { describe, it, expect, vi, beforeEach } from "vitest";

const { getMany } = vi.hoisted(() => ({ getMany: vi.fn() }));
const { createQueryBuilder } = vi.hoisted(() => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.distinctOn = vi.fn(chain);
  builder.where = vi.fn(chain);
  builder.andWhere = vi.fn(chain);
  builder.orderBy = vi.fn(chain);
  builder.addOrderBy = vi.fn(chain);
  builder.getMany = vi.fn();
  return { createQueryBuilder: vi.fn(() => builder) };
});
const { insert, update } = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ createQueryBuilder, insert, update })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const {
  getLatestOverridesForZones,
  getOverridesForZoneInRange,
  createManualOverride,
  revokeManualOverride,
} = await import("~/server/util/routes/manualOverride");

describe("getLatestOverridesForZones", () => {
  beforeEach(() => {
    getMany.mockReset();
  });

  it("returns an empty map without querying when given no zone ids", async () => {
    const result = await getLatestOverridesForZones([]);
    expect(result.size).toBe(0);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it("maps the latest row per zone, resolving config and expiry timestamps", async () => {
    const builder = createQueryBuilder();
    (builder.getMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        zone_id: "z1",
        config: {
          kind: "position",
          value: 50,
          hold_type: "permanent",
          actor: "Martin",
        },
        creation_time: new Date("2026-01-01T00:00:00.000Z"),
        expires_at: null,
        revoked_at: null,
      },
    ]);
    const result = await getLatestOverridesForZones(["z1"]);
    expect(result.get("z1")).toEqual({
      zoneId: "z1",
      config: {
        kind: "position",
        value: 50,
        hold_type: "permanent",
        actor: "Martin",
      },
      createdAtMs: new Date("2026-01-01T00:00:00.000Z").getTime(),
      expiresAtMs: null,
      revokedAtMs: null,
    });
  });
});

describe("createManualOverride", () => {
  it("inserts an append-only row with modified_time = creation_time", async () => {
    insert.mockReset().mockResolvedValue(undefined);
    const row = await createManualOverride({
      installationId: "inst-1",
      zoneId: "z1",
      config: {
        kind: "position",
        value: 50,
        hold_type: "2h",
        actor: "Martin",
      },
      expiresAtMs: 123456,
    });
    expect(insert).toHaveBeenCalledOnce();
    const inserted = insert.mock.calls[0][0];
    expect(inserted.modified_time).toBe(inserted.creation_time);
    expect(row.zoneId).toBe("z1");
    expect(row.expiresAtMs).toBe(123456);
    expect(row.createdAtMs).toBe(inserted.creation_time.getTime());
  });
});

describe("getOverridesForZoneInRange", () => {
  beforeEach(() => {
    getMany.mockReset();
  });

  it("maps every row in the window, ascending by creation time", async () => {
    const builder = createQueryBuilder();
    (builder.getMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "mo-1",
        zone_id: "z1",
        config: {
          kind: "position",
          value: 40,
          hold_type: "2h",
          actor: "Martin",
        },
        creation_time: new Date("2026-01-01T00:00:00.000Z"),
        expires_at: new Date("2026-01-01T02:00:00.000Z"),
        revoked_at: null,
      },
    ]);

    const rows = await getOverridesForZoneInRange("z1", 0, 1000);

    expect(rows).toEqual([
      {
        id: "mo-1",
        zoneId: "z1",
        config: {
          kind: "position",
          value: 40,
          hold_type: "2h",
          actor: "Martin",
        },
        createdAtMs: new Date("2026-01-01T00:00:00.000Z").getTime(),
        expiresAtMs: new Date("2026-01-01T02:00:00.000Z").getTime(),
        revokedAtMs: null,
      },
    ]);
    expect(builder.where).toHaveBeenCalledWith("mo.zone_id = :zoneId", {
      zoneId: "z1",
    });
  });
});

describe("revokeManualOverride", () => {
  it("sets revoked_at and bumps modified_time, never touching the config", async () => {
    update.mockReset().mockResolvedValue(undefined);
    await revokeManualOverride("mo-1");
    expect(update).toHaveBeenCalledWith(
      "mo-1",
      expect.objectContaining({
        revoked_at: expect.any(Date),
        modified_time: expect.any(Date),
      }),
    );
    expect(update.mock.calls[0][1]).not.toHaveProperty("config");
  });
});
