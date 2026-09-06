import { describe, it, expect, vi, beforeEach } from "vitest";

const { get, set, del } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));
vi.mock("~/server/util/redis", () => ({
  redis: { get, set, del },
}));

const { storePendingSignup, getPendingSignup, deletePendingSignup } =
  await import("~/server/util/pendingSignup");

describe("pendingSignup", () => {
  beforeEach(() => {
    get.mockReset();
    set.mockReset().mockResolvedValue(undefined);
    del.mockReset().mockResolvedValue(undefined);
  });

  it("stores a pending signup with a 24h TTL", async () => {
    await storePendingSignup("a@example.com", { passwordHash: "hash" });
    expect(set).toHaveBeenCalledWith(
      "auth:pending-signup:a@example.com",
      JSON.stringify({ passwordHash: "hash" }),
      "EX",
      24 * 60 * 60,
    );
  });

  it("returns null when nothing is pending", async () => {
    get.mockResolvedValue(null);
    expect(await getPendingSignup("a@example.com")).toBeNull();
  });

  it("parses a stored pending signup", async () => {
    get.mockResolvedValue(JSON.stringify({ passwordHash: "hash" }));
    expect(await getPendingSignup("a@example.com")).toEqual({
      passwordHash: "hash",
    });
  });

  it("fails closed (returns null, not a bypass) when Redis is unreachable", async () => {
    get.mockRejectedValue(new Error("down"));
    expect(await getPendingSignup("a@example.com")).toBeNull();
  });

  it("deletes the pending signup key", async () => {
    await deletePendingSignup("a@example.com");
    expect(del).toHaveBeenCalledWith("auth:pending-signup:a@example.com");
  });
});
