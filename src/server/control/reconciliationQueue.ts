import { redis } from "~/server/util/redis";

export interface ReconciliationQueue {
  enqueue(zoneId: string, dueAtMs: number): Promise<void>;
  dequeueDue(nowMs: number): Promise<string[]>;
  remove(zoneId: string): Promise<void>;
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
    async enqueue(zoneId, dueAtMs) {
      await redis.zadd(KEY, dueAtMs, zoneId);
    },
    async dequeueDue(nowMs) {
      const due = await redis.zrangebyscore(KEY, 0, nowMs);
      if (due.length > 0) await redis.zrem(KEY, ...due);
      return due;
    },
    async remove(zoneId) {
      await redis.zrem(KEY, zoneId);
    },
  };
}

/** In-memory fake for functional tests. */
export function createInMemoryReconciliationQueue(): ReconciliationQueue {
  const pending = new Map<string, number>();
  return {
    async enqueue(zoneId, dueAtMs) {
      pending.set(zoneId, dueAtMs);
    },
    async dequeueDue(nowMs) {
      const due = [...pending.entries()]
        .filter(([, at]) => at <= nowMs)
        .map(([zoneId]) => zoneId);
      due.forEach((zoneId) => pending.delete(zoneId));
      return due;
    },
    async remove(zoneId) {
      pending.delete(zoneId);
    },
  };
}
