import { describe, it, expect, vi, beforeEach } from "vitest";

const { query, insert, count, update, deleteFn } = vi.hoisted(() => ({
  query: vi.fn(),
  insert: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  deleteFn: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({
    insert,
    count,
    update,
    delete: deleteFn,
  })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository, query }) },
  qualifiedTable: (table: string) => `"public".${table}`,
}));

const {
  listAccessibleInstallations,
  createInstallationMember,
  countOwners,
  listMembersForInstallation,
  getInstallationMemberById,
  updateInstallationMember,
  deleteInstallationMember,
} = await import("~/server/util/routes/installationMember");

describe("installationMember accessor", () => {
  beforeEach(() => {
    query.mockReset();
    insert.mockReset().mockResolvedValue(undefined);
    count.mockReset();
    update.mockReset().mockResolvedValue(undefined);
    deleteFn.mockReset().mockResolvedValue(undefined);
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

  it("inserts a membership row, defaulting scope to unrestricted, and returns its id", async () => {
    const result = await createInstallationMember({
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
    expect(result.id).toBe(inserted.id);
    expect(result.createdAt).toBe(inserted.creation_time);
  });

  it("counts owner rows for an installation", async () => {
    count.mockResolvedValue(1);
    expect(await countOwners("inst-1")).toBe(1);
    expect(count).toHaveBeenCalledWith({
      where: { installation_id: "inst-1", role: "owner" },
    });
  });

  it("lists every member of an installation, joined to their email", async () => {
    query.mockResolvedValue([
      {
        id: "member-1",
        installation_id: "inst-1",
        user_id: "user-1",
        email: "a@example.com",
        role: "owner",
        scope: { air_handler_ids: "*" },
        creation_time: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);
    const result = await listMembersForInstallation("inst-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("JOIN"), [
      "inst-1",
    ]);
    expect(result).toEqual([
      {
        id: "member-1",
        installationId: "inst-1",
        userId: "user-1",
        email: "a@example.com",
        role: "owner",
        scope: { air_handler_ids: "*" },
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);
  });

  it("getInstallationMemberById returns null when no row matches", async () => {
    query.mockResolvedValue([]);
    expect(await getInstallationMemberById("missing")).toBeNull();
  });

  it("getInstallationMemberById maps a found row", async () => {
    query.mockResolvedValue([
      {
        id: "member-1",
        installation_id: "inst-1",
        user_id: "user-1",
        email: "a@example.com",
        role: "write",
        scope: { air_handler_ids: "*" },
        creation_time: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);
    expect(await getInstallationMemberById("member-1")).toEqual({
      id: "member-1",
      installationId: "inst-1",
      userId: "user-1",
      email: "a@example.com",
      role: "write",
      scope: { air_handler_ids: "*" },
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
  });

  it("updates a membership's role/scope", async () => {
    await updateInstallationMember("member-1", { role: "read" });
    expect(update).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ role: "read" }),
    );
  });

  it("deletes a membership", async () => {
    await deleteInstallationMember("member-1");
    expect(deleteFn).toHaveBeenCalledWith("member-1");
  });
});
