import { describe, it, expect, vi, beforeEach } from "vitest";

const { getMany } = vi.hoisted(() => ({ getMany: vi.fn() }));
const { createQueryBuilder } = vi.hoisted(() => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.distinctOn = vi.fn(chain);
  builder.where = vi.fn(chain);
  builder.orderBy = vi.fn(chain);
  builder.addOrderBy = vi.fn(chain);
  builder.getMany = vi.fn();
  return { createQueryBuilder: vi.fn(() => builder) };
});
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ createQueryBuilder })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { getLatestOverridesForZones } =
  await import("~/server/util/routes/manualOverride");

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
      expiresAtMs: null,
      revokedAtMs: null,
    });
  });
});
