import { describe, it, expect, vi } from "vitest";
import {
  notifyOnce,
  clearNotification,
  type RedisDedup,
} from "~/server/util/notificationDedup";

function fakeRedis(overrides: Partial<RedisDedup> = {}): RedisDedup {
  return {
    exists: vi.fn().mockResolvedValue(0),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("notifyOnce", () => {
  it("sends and marks the key when it hasn't fired before", async () => {
    const redis = fakeRedis({ exists: vi.fn().mockResolvedValue(0) });
    const send = vi.fn();
    const sent = await notifyOnce("key-1", send, redis);
    expect(sent).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalledWith("key-1", "1");
  });

  it("suppresses when the key is already set", async () => {
    const redis = fakeRedis({ exists: vi.fn().mockResolvedValue(1) });
    const send = vi.fn();
    const sent = await notifyOnce("key-1", send, redis);
    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("fails open — sends when Redis itself is unreachable", async () => {
    const redis = fakeRedis({
      exists: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    const send = vi.fn();
    const sent = await notifyOnce("key-1", send, redis);
    expect(sent).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it("awaits an async send before resolving", async () => {
    const redis = fakeRedis();
    let resolved = false;
    const send = async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
    };
    await notifyOnce("key-1", send, redis);
    expect(resolved).toBe(true);
  });
});

describe("clearNotification", () => {
  it("deletes the dedup key", async () => {
    const redis = fakeRedis();
    await clearNotification("key-1", redis);
    expect(redis.del).toHaveBeenCalledWith("key-1");
  });

  it("never throws even if Redis is unreachable", async () => {
    const redis = fakeRedis({
      del: vi.fn().mockRejectedValue(new Error("down")),
    });
    await expect(clearNotification("key-1", redis)).resolves.toBeUndefined();
  });
});
