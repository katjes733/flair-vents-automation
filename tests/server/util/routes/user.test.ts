import { describe, it, expect, vi, beforeEach } from "vitest";

const { findOneBy, insert } = vi.hoisted(() => ({
  findOneBy: vi.fn(),
  insert: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ findOneBy, insert })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { getUserByEmail, getUserById, createUser } =
  await import("~/server/util/routes/user");

describe("user accessor", () => {
  beforeEach(() => {
    findOneBy.mockReset();
    insert.mockReset().mockResolvedValue(undefined);
  });

  it("returns null when no user exists for the email", async () => {
    findOneBy.mockResolvedValue(null);
    expect(await getUserByEmail("nobody@example.com")).toBeNull();
  });

  it("maps a found row to UserData", async () => {
    findOneBy.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      password_hash: "hash",
      user_details: { displayName: "A" },
    });
    expect(await getUserByEmail("a@example.com")).toEqual({
      id: "user-1",
      email: "a@example.com",
      passwordHash: "hash",
      userDetails: { displayName: "A" },
    });
  });

  it("finds by id the same way", async () => {
    findOneBy.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      password_hash: "hash",
      user_details: {},
    });
    const result = await getUserById("user-1");
    expect(result?.id).toBe("user-1");
    expect(findOneBy).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("creates a user with a generated id and default empty user_details", async () => {
    const result = await createUser({
      email: "new@example.com",
      passwordHash: "hash",
    });
    expect(insert).toHaveBeenCalledOnce();
    const inserted = insert.mock.calls[0][0];
    expect(inserted.email).toBe("new@example.com");
    expect(inserted.user_details).toEqual({});
    expect(result.id).toBe(inserted.id);
    expect(result.userDetails).toEqual({});
  });
});
