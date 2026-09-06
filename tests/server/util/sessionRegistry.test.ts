import { describe, it, expect, vi, beforeEach } from "vitest";

const { redis } = vi.hoisted(() => ({
  redis: {
    sadd: vi.fn(),
    srem: vi.fn(),
    expire: vi.fn(),
    smembers: vi.fn(),
    del: vi.fn(),
  },
}));
vi.mock("~/server/util/redis", () => ({ redis }));

const { registerSession, unregisterSession, invalidateAllSessionsForUser } =
  await import("~/server/util/sessionRegistry");

beforeEach(() => {
  redis.sadd.mockReset().mockResolvedValue(1);
  redis.srem.mockReset().mockResolvedValue(1);
  redis.expire.mockReset().mockResolvedValue(1);
  redis.smembers.mockReset().mockResolvedValue([]);
  redis.del.mockReset().mockResolvedValue(1);
});

describe("registerSession", () => {
  it("adds the session id to the user's set and refreshes its TTL", async () => {
    await registerSession("a@example.com", "sid-1");
    expect(redis.sadd).toHaveBeenCalledWith(
      "user-sessions:a@example.com",
      "sid-1",
    );
    expect(redis.expire).toHaveBeenCalledWith(
      "user-sessions:a@example.com",
      4 * 60 * 60,
    );
  });
});

describe("unregisterSession", () => {
  it("removes just the one session id from the user's set", async () => {
    await unregisterSession("a@example.com", "sid-1");
    expect(redis.srem).toHaveBeenCalledWith(
      "user-sessions:a@example.com",
      "sid-1",
    );
  });
});

describe("invalidateAllSessionsForUser", () => {
  it("deletes every known session's own store key, plus the index itself", async () => {
    redis.smembers.mockResolvedValue(["sid-1", "sid-2"]);
    await invalidateAllSessionsForUser("a@example.com");
    expect(redis.del).toHaveBeenCalledWith("sess:sid-1", "sess:sid-2");
    expect(redis.del).toHaveBeenCalledWith("user-sessions:a@example.com");
  });

  it("still deletes the index even when there are no known sessions", async () => {
    redis.smembers.mockResolvedValue([]);
    await invalidateAllSessionsForUser("a@example.com");
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith("user-sessions:a@example.com");
  });
});
