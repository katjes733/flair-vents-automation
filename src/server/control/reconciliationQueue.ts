import { redis } from "~/server/util/redis";

// A plain string key — `${zoneId}:${flairVentId}` for a controllable
// zone's own vents, per "Multi-Vent Zones" in the implementation plan.
// This queue is deliberately generic about what the key means: calling
// enqueue() twice for the same key coalesces into one entry (ZADD/Map.set
// semantics), which is exactly why every zone's vents each need their own
// distinct key — two vents in the same zone must never share one.
export interface ReconciliationQueue {
  enqueue(key: string, dueAtMs: number): Promise<void>;
  dequeueDue(nowMs: number): Promise<string[]>;
  remove(key: string): Promise<void>;
}

const KEY = "recon:pending";

/**
 * A Redis sorted set (score = due-time), swept at step 3 of each tick —
 * costs zero additional Flair API budget, since the tick already polls
 * every vent's reported position. See "Reconciliation & startup
 * reconciliation".
 */
export function createRedisReconciliationQueue(): ReconciliationQueue {
  return {
    async enqueue(key, dueAtMs) {
      await redis.zadd(KEY, dueAtMs, key);
    },
    async dequeueDue(nowMs) {
      const due = await redis.zrangebyscore(KEY, 0, nowMs);
      if (due.length > 0) await redis.zrem(KEY, ...due);
      return due;
    },
    async remove(key) {
      await redis.zrem(KEY, key);
    },
  };
}

/** In-memory fake for functional tests. */
export function createInMemoryReconciliationQueue(): ReconciliationQueue {
  const pending = new Map<string, number>();
  return {
    async enqueue(key, dueAtMs) {
      pending.set(key, dueAtMs);
    },
    async dequeueDue(nowMs) {
      const due = [...pending.entries()]
        .filter(([, at]) => at <= nowMs)
        .map(([key]) => key);
      due.forEach((key) => pending.delete(key));
      return due;
    },
    async remove(key) {
      pending.delete(key);
    },
  };
}
