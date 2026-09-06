import { describe, it, expect, vi, beforeEach } from "vitest";

const { get, incr, expire, del } = vi.hoisted(() => ({
  get: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
}));
vi.mock("~/server/util/redis", () => ({
  redis: { get, incr, expire, del },
}));

const { isLockedOut, recordFailure, clearLockout } =
  await import("~/server/util/authLockout");

describe("authLockout", () => {
  beforeEach(() => {
    get.mockReset();
    incr.mockReset();
    expire.mockReset();
    del.mockReset();
  });

  describe("isLockedOut", () => {
    it("is false when no failures are recorded", async () => {
      get.mockResolvedValue(null);
      expect(await isLockedOut("a@example.com")).toBe(false);
    });

    it("is false below the max failure count", async () => {
      get.mockResolvedValue("4");
      expect(await isLockedOut("a@example.com")).toBe(false);
    });

    it("is true at or above the max failure count", async () => {
      get.mockResolvedValue("5");
      expect(await isLockedOut("a@example.com")).toBe(true);
    });

    it("fails open when Redis is unreachable", async () => {
      get.mockRejectedValue(new Error("down"));
      expect(await isLockedOut("a@example.com")).toBe(false);
    });
  });

  describe("recordFailure", () => {
    it("sets a TTL only on the first recorded failure", async () => {
      incr.mockResolvedValue(1);
      await recordFailure("a@example.com");
      expect(expire).toHaveBeenCalledWith(
        "auth:lockout:a@example.com",
        15 * 60,
      );
    });

    it("does not re-set the TTL on subsequent failures", async () => {
      incr.mockResolvedValue(2);
      await recordFailure("a@example.com");
      expect(expire).not.toHaveBeenCalled();
    });

    it("never throws when Redis is unreachable", async () => {
      incr.mockRejectedValue(new Error("down"));
      await expect(recordFailure("a@example.com")).resolves.toBeUndefined();
    });
  });

  describe("clearLockout", () => {
    it("deletes the lockout key", async () => {
      await clearLockout("a@example.com");
      expect(del).toHaveBeenCalledWith("auth:lockout:a@example.com");
    });

    it("never throws when Redis is unreachable", async () => {
      del.mockRejectedValue(new Error("down"));
      await expect(clearLockout("a@example.com")).resolves.toBeUndefined();
    });
  });
});
