import { redis } from "~/server/util/redis";
import type { SpikeReading } from "~/server/domain/sensors/spikeDetection";

export interface SpikeBufferStore {
  append(zoneId: string, reading: SpikeReading): Promise<void>;
  getWindow(
    zoneId: string,
    nowMs: number,
    windowMinutes: number,
  ): Promise<SpikeReading[]>;
}

const RETENTION_MS = 30 * 60 * 1000; // comfortably beyond any real spike window

function toMember(reading: SpikeReading): string {
  return `${reading.timestampMs}:${reading.temperatureC}`;
}

function fromMember(member: string): SpikeReading {
  const separatorIndex = member.indexOf(":");
  return {
    timestampMs: Number(member.slice(0, separatorIndex)),
    temperatureC: Number(member.slice(separatorIndex + 1)),
  };
}

/**
 * Redis sorted-set backed buffer, per zone. ZADD's idempotent-on-
 * identical-score+member behavior dedupes a re-polled, unchanged stale
 * reading with zero application-level logic — see "Dynamic thermal spike
 * detection" in the implementation plan. Old entries are trimmed on every
 * append so the set never grows unbounded.
 */
export function createRedisSpikeBufferStore(): SpikeBufferStore {
  return {
    async append(zoneId, reading) {
      const key = `spike:${zoneId}`;
      await redis.zadd(key, reading.timestampMs, toMember(reading));
      await redis.zremrangebyscore(key, 0, reading.timestampMs - RETENTION_MS);
    },
    async getWindow(zoneId, nowMs, windowMinutes) {
      const key = `spike:${zoneId}`;
      const raw = await redis.zrangebyscore(
        key,
        nowMs - windowMinutes * 60000,
        nowMs,
      );
      return raw.map(fromMember);
    },
  };
}

/** In-memory fake for functional tests — no Docker/Redis dependency (see harness conventions). */
export function createInMemorySpikeBufferStore(): SpikeBufferStore {
  const store = new Map<string, Map<string, SpikeReading>>();
  return {
    async append(zoneId, reading) {
      const zoneMap = store.get(zoneId) ?? new Map<string, SpikeReading>();
      zoneMap.set(toMember(reading), reading);
      store.set(zoneId, zoneMap);
    },
    async getWindow(zoneId, nowMs, windowMinutes) {
      const zoneMap = store.get(zoneId);
      if (!zoneMap) return [];
      const cutoff = nowMs - windowMinutes * 60000;
      return [...zoneMap.values()]
        .filter((r) => r.timestampMs >= cutoff && r.timestampMs <= nowMs)
        .sort((a, b) => a.timestampMs - b.timestampMs);
    },
  };
}
