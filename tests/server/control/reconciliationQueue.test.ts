import { describe, it, expect, vi, beforeEach } from "vitest";
import { createInMemoryReconciliationQueue } from "~/server/control/reconciliationQueue";

const NOW = Date.UTC(2024, 0, 1, 12, 0);

const { zadd, zrangebyscore, zrem } = vi.hoisted(() => ({
  zadd: vi.fn(),
  zrangebyscore: vi.fn(),
  zrem: vi.fn(),
}));
vi.mock("~/server/util/redis", () => ({
  redis: { zadd, zrangebyscore, zrem },
}));

const { createRedisReconciliationQueue } =
  await import("~/server/control/reconciliationQueue");

describe("createRedisReconciliationQueue", () => {
  beforeEach(() => {
    zadd.mockReset();
    zrangebyscore.mockReset().mockResolvedValue([]);
    zrem.mockReset();
  });

  it("enqueues via ZADD with the due time as score", async () => {
    const queue = createRedisReconciliationQueue();
    await queue.enqueue("z1", NOW + 90000);
    expect(zadd).toHaveBeenCalledWith("recon:pending", NOW + 90000, "z1");
  });

  it("dequeues due entries via ZRANGEBYSCORE and removes them via ZREM", async () => {
    zrangebyscore.mockResolvedValue(["z1", "z2"]);
    const queue = createRedisReconciliationQueue();
    const due = await queue.dequeueDue(NOW);
    expect(zrangebyscore).toHaveBeenCalledWith("recon:pending", 0, NOW);
    expect(zrem).toHaveBeenCalledWith("recon:pending", "z1", "z2");
    expect(due).toEqual(["z1", "z2"]);
  });

  it("does not call ZREM when nothing is due", async () => {
    const queue = createRedisReconciliationQueue();
    await queue.dequeueDue(NOW);
    expect(zrem).not.toHaveBeenCalled();
  });

  it("remove() cancels a pending entry via ZREM", async () => {
    const queue = createRedisReconciliationQueue();
    await queue.remove("z1");
    expect(zrem).toHaveBeenCalledWith("recon:pending", "z1");
  });
});

describe("createInMemoryReconciliationQueue", () => {
  it("dequeues only entries due at or before now, and removes them", async () => {
    const queue = createInMemoryReconciliationQueue();
    await queue.enqueue("z1", NOW - 1000);
    await queue.enqueue("z2", NOW + 60000);

    const due = await queue.dequeueDue(NOW);
    expect(due).toEqual(["z1"]);

    const dueAgain = await queue.dequeueDue(NOW);
    expect(dueAgain).toEqual([]); // already dequeued, not re-returned
  });

  it("remove() cancels a pending entry outright", async () => {
    const queue = createInMemoryReconciliationQueue();
    await queue.enqueue("z1", NOW - 1000);
    await queue.remove("z1");
    expect(await queue.dequeueDue(NOW)).toEqual([]);
  });
});
