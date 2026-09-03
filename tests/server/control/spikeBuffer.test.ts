import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInMemorySpikeBufferStore } from "~/server/control/spikeBuffer";

const NOW = Date.UTC(2024, 0, 1, 12, 0);

const { zadd, zremrangebyscore, zrangebyscore } = vi.hoisted(() => ({
  zadd: vi.fn(),
  zremrangebyscore: vi.fn(),
  zrangebyscore: vi.fn(),
}));
vi.mock("~/server/util/redis", () => ({
  redis: { zadd, zremrangebyscore, zrangebyscore },
}));

const { createRedisSpikeBufferStore } =
  await import("~/server/control/spikeBuffer");

describe("createRedisSpikeBufferStore", () => {
  beforeEach(() => {
    zadd.mockReset();
    zremrangebyscore.mockReset();
    zrangebyscore.mockReset().mockResolvedValue([]);
  });

  it("appends via ZADD (score = timestamp) and trims anything older than the retention window", async () => {
    const store = createRedisSpikeBufferStore();
    await store.append("z1", { timestampMs: NOW, temperatureC: 21.5 });
    expect(zadd).toHaveBeenCalledWith("spike:z1", NOW, `${NOW}:21.5`);
    expect(zremrangebyscore).toHaveBeenCalledWith(
      "spike:z1",
      0,
      NOW - 30 * 60 * 1000,
    );
  });

  it("reads a window via ZRANGEBYSCORE and parses timestamp:temperature members back out", async () => {
    zrangebyscore.mockResolvedValue([`${NOW - 60000}:20`, `${NOW}:21.5`]);
    const store = createRedisSpikeBufferStore();
    const result = await store.getWindow("z1", NOW, 10);
    expect(zrangebyscore).toHaveBeenCalledWith(
      "spike:z1",
      NOW - 10 * 60000,
      NOW,
    );
    expect(result).toEqual([
      { timestampMs: NOW - 60000, temperatureC: 20 },
      { timestampMs: NOW, temperatureC: 21.5 },
    ]);
  });

  it("round-trips a negative temperature correctly", async () => {
    zrangebyscore.mockResolvedValue([`${NOW}:-5.2`]);
    const store = createRedisSpikeBufferStore();
    const result = await store.getWindow("z1", NOW, 10);
    expect(result).toEqual([{ timestampMs: NOW, temperatureC: -5.2 }]);
  });
});

describe("createInMemorySpikeBufferStore", () => {
  it("returns appended readings within the requested window, in timestamp order", async () => {
    const store = createInMemorySpikeBufferStore();
    await store.append("z1", {
      timestampMs: NOW - 5 * 60000,
      temperatureC: 21,
    });
    await store.append("z1", {
      timestampMs: NOW - 2 * 60000,
      temperatureC: 21.5,
    });
    await store.append("z1", {
      timestampMs: NOW - 20 * 60000,
      temperatureC: 20,
    }); // outside window

    const window = await store.getWindow("z1", NOW, 10);
    expect(window.map((r) => r.temperatureC)).toEqual([21, 21.5]);
  });

  it("dedupes an identical (timestamp, value) append — mirrors real ZADD idempotency", async () => {
    const store = createInMemorySpikeBufferStore();
    await store.append("z1", { timestampMs: NOW, temperatureC: 21 });
    await store.append("z1", { timestampMs: NOW, temperatureC: 21 });

    const window = await store.getWindow("z1", NOW, 10);
    expect(window).toHaveLength(1);
  });

  it("keeps zones independent", async () => {
    const store = createInMemorySpikeBufferStore();
    await store.append("z1", { timestampMs: NOW, temperatureC: 21 });
    const window = await store.getWindow("z2", NOW, 10);
    expect(window).toEqual([]);
  });
});
