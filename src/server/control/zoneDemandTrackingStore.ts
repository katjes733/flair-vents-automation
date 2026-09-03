import { redis } from "~/server/util/redis";

// "Zone demand with no improvement" needs its own per-zone snapshot of
// when the zone started being commanded near its ceiling and how far off
// it was at that moment — high-churn, disposable per-tick data, same
// category as airHandlerRuntimeStore's own state (see the Data Model's
// "Redis, not Postgres" rule for exactly this kind of data). Kept as its
// own store rather than folded into ZoneRuntimeState since that struct is
// DB-persisted and diff-checked on write — this churns every tick a zone
// is demanding, which that isn't shaped for.
export interface ZoneDemandTrackingState {
  demandStartedAtMs: number | null;
  worstDeviationAtDemandStart: number | null;
  // "Duct airflow anomaly" needs the same shape of tracking (when did
  // this zone's isolated anomaly first start, so the alert can require it
  // sustained past duct_anomaly_alert_minutes) — a second, unrelated
  // caller of the same per-zone ephemeral-state pattern, not a reason to
  // fork a second store.
  ductAnomalySinceMs: number | null;
}

export const EMPTY_ZONE_DEMAND_TRACKING_STATE: ZoneDemandTrackingState = {
  demandStartedAtMs: null,
  worstDeviationAtDemandStart: null,
  ductAnomalySinceMs: null,
};

export interface ZoneDemandTrackingStore {
  get(zoneId: string): Promise<ZoneDemandTrackingState>;
  set(zoneId: string, state: ZoneDemandTrackingState): Promise<void>;
}

export function createRedisZoneDemandTrackingStore(): ZoneDemandTrackingStore {
  return {
    async get(zoneId) {
      const raw = await redis.get(`zone:${zoneId}:demandTracking`);
      return raw
        ? { ...EMPTY_ZONE_DEMAND_TRACKING_STATE, ...JSON.parse(raw) }
        : { ...EMPTY_ZONE_DEMAND_TRACKING_STATE };
    },
    async set(zoneId, state) {
      await redis.set(`zone:${zoneId}:demandTracking`, JSON.stringify(state));
    },
  };
}

/** In-memory fake for functional tests. */
export function createInMemoryZoneDemandTrackingStore(): ZoneDemandTrackingStore {
  const store = new Map<string, ZoneDemandTrackingState>();
  return {
    async get(zoneId) {
      return store.get(zoneId) ?? { ...EMPTY_ZONE_DEMAND_TRACKING_STATE };
    },
    async set(zoneId, state) {
      store.set(zoneId, state);
    },
  };
}
