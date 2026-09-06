import { describe, it, expect, vi, beforeEach } from "vitest";

const { query, insert, count } = vi.hoisted(() => ({
  query: vi.fn(),
  insert: vi.fn(),
  count: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ insert, count })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository, query }) },
  qualifiedTable: (table: string) => `"public".${table}`,
}));

const { listAccessibleInstallations, createInstallationMember, countOwners } =
  await import("~/server/util/routes/installationMember");

describe("installationMember accessor", () => {
  beforeEach(() => {
    query.mockReset();
    insert.mockReset().mockResolvedValue(undefined);
    count.mockReset();
  });

  it("joins installation_members to installations and maps the result", async () => {
    query.mockResolvedValue([
      {
        installation_id: "inst-1",
        installation_name: "Upstairs",
        role: "owner",
        scope: { air_handler_ids: "*" },
      },
    ]);

    const result = await listAccessibleInstallations("user-1");

    expect(query).toHaveBeenCalledWith(expect.stringContaining("JOIN"), [
      "user-1",
    ]);
    expect(result).toEqual([
      {
        installationId: "inst-1",
        installationName: "Upstairs",
        role: "owner",
        scope: { air_handler_ids: "*" },
      },
    ]);
  });

  it("returns an empty array when the user has no memberships", async () => {
    query.mockResolvedValue([]);
    expect(await listAccessibleInstallations("user-1")).toEqual([]);
  });

  it("inserts a membership row, defaulting scope to unrestricted", async () => {
    await createInstallationMember({
      installationId: "inst-1",
      userId: "user-1",
      role: "write",
    });
    expect(insert).toHaveBeenCalledOnce();
    const inserted = insert.mock.calls[0][0];
    expect(inserted.installation_id).toBe("inst-1");
    expect(inserted.user_id).toBe("user-1");
    expect(inserted.role).toBe("write");
    expect(inserted.scope).toEqual({ air_handler_ids: "*" });
  });

  it("counts owner rows for an installation", async () => {
    count.mockResolvedValue(1);
    expect(await countOwners("inst-1")).toBe(1);
    expect(count).toHaveBeenCalledWith({
      where: { installation_id: "inst-1", role: "owner" },
    });
  });
});
