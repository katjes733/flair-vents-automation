import { describe, it, expect, vi, beforeEach } from "vitest";

const { findOneBy, find, update, deleteFn, insert } = vi.hoisted(() => ({
  findOneBy: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  deleteFn: vi.fn(),
  insert: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({
    findOneBy,
    find,
    update,
    delete: deleteFn,
    insert,
  })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const webauthnCredentials =
  await import("~/server/util/routes/webauthnCredential");

describe("webauthnCredential accessor", () => {
  beforeEach(() => {
    findOneBy.mockReset();
    find.mockReset();
    update.mockReset().mockResolvedValue(undefined);
    deleteFn.mockReset().mockResolvedValue(undefined);
    insert.mockReset().mockResolvedValue(undefined);
  });

  it("creates a credential with sign_counter starting at 0", async () => {
    const record = await webauthnCredentials.create({
      userId: "user-1",
      credentialId: "cred-1",
      publicKey: "pk",
      deviceType: "multiDevice",
      backedUp: true,
      nickname: "iPhone",
    });
    expect(insert).toHaveBeenCalledOnce();
    expect(record.sign_counter).toBe(0);
    expect(record.user_id).toBe("user-1");
    expect(record.nickname).toBe("iPhone");
  });

  it("defaults nickname/transports to null when omitted", async () => {
    const record = await webauthnCredentials.create({
      userId: "user-1",
      credentialId: "cred-1",
      publicKey: "pk",
      deviceType: "singleDevice",
      backedUp: false,
    });
    expect(record.nickname).toBeNull();
    expect(record.transports).toBeNull();
  });

  it("finds by credential id", async () => {
    findOneBy.mockResolvedValue({ id: "row-1" });
    const result = await webauthnCredentials.findByCredentialId("cred-1");
    expect(findOneBy).toHaveBeenCalledWith({ credential_id: "cred-1" });
    expect(result).toEqual({ id: "row-1" });
  });

  it("finds all credentials for a user, oldest first", async () => {
    find.mockResolvedValue([{ id: "row-1" }]);
    await webauthnCredentials.findByUserId("user-1");
    expect(find).toHaveBeenCalledWith({
      where: { user_id: "user-1" },
      order: { creation_time: "ASC" },
    });
  });

  it("records use — bumps sign_counter and last_used_at", async () => {
    await webauthnCredentials.recordUse("row-1", 42);
    expect(update).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({ sign_counter: 42 }),
    );
  });

  it("deleteForUser returns null and does not delete when the row doesn't belong to that user", async () => {
    findOneBy.mockResolvedValue(null);
    const result = await webauthnCredentials.deleteForUser("row-1", "user-1");
    expect(result).toBeNull();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it("deleteForUser deletes and returns the row when owned", async () => {
    findOneBy.mockResolvedValue({ id: "row-1", nickname: "iPhone" });
    const result = await webauthnCredentials.deleteForUser("row-1", "user-1");
    expect(deleteFn).toHaveBeenCalledWith({ id: "row-1", user_id: "user-1" });
    expect(result).toEqual({ id: "row-1", nickname: "iPhone" });
  });
});
