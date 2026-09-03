import { redis } from "~/server/util/redis";

// Driving-zone tracking state (which zone is tracked, the hysteresis dwell
// counter, the smoothed offset, the last pushed setpoint) is exactly the
// "high-churn, disposable per-tick data" the Data Model assigns to Redis,
// not Postgres — not named as its own field-by-field shape in the plan,
// but a direct application of that same rule. Reconstructable from
// scratch on a cache miss (dynamic selection just re-picks fresh, offset
// re-converges over a few ticks), so no durability guarantee is needed.
export interface AirHandlerRuntimeState {
  trackedDrivingZoneId: string | null;
  ticksSinceLeadChanged: number;
  smoothedOffsetC: number;
  lastPushedSetpointC: number | null;
  // When the current HVAC call state began — the input
  // detectEquipmentFault()'s grace period and the "extended call, no
  // improvement" heuristic both need, and not something any single tick
  // can know without remembering it from the last one.
  lastHvacState: string | null;
  callStartedAtMs: number | null;
  // The worst (largest) deviation among demanding zones at the moment
  // this call began — "HVAC extended call with no improvement"'s
  // snapshot-vs-now comparison. Reset alongside callStartedAtMs on every
  // call-state transition, per the plan's Emergency fail-safe section.
  worstDeviationAtCallStartC: number | null;
  // Equipment fail-safe hysteresis — a dwell before clearing, mirroring
  // spike detection's pattern, so a transient recovery reading can't flap
  // the fault state. See "Emergency fail-safe".
  equipmentFaultActive: boolean;
  equipmentFaultClearDwellSinceMs: number | null;
  // The periodic drift-check backstop's own cadence — independent of
  // reconciliation's per-command retry state, since a vent that already
  // reconciled successfully is exactly the case this re-checks: it has no
  // true position feedback and can drift after the fact with no pending
  // command to catch it. See "Resolved Design Decisions" (min_step_delta
  // vs. modulation_step_size) for why this backstop exists at all.
  ticksSinceDriftCheck: number;
}

export const EMPTY_AIR_HANDLER_RUNTIME_STATE: AirHandlerRuntimeState = {
  trackedDrivingZoneId: null,
  ticksSinceLeadChanged: 0,
  smoothedOffsetC: 0,
  lastPushedSetpointC: null,
  lastHvacState: null,
  callStartedAtMs: null,
  worstDeviationAtCallStartC: null,
  equipmentFaultActive: false,
  equipmentFaultClearDwellSinceMs: null,
  ticksSinceDriftCheck: 0,
};

export interface AirHandlerRuntimeStore {
  get(airHandlerId: string): Promise<AirHandlerRuntimeState>;
  set(airHandlerId: string, state: AirHandlerRuntimeState): Promise<void>;
}

export function createRedisAirHandlerRuntimeStore(): AirHandlerRuntimeStore {
  return {
    async get(airHandlerId) {
      const raw = await redis.get(`ah:${airHandlerId}:runtime`);
      return raw
        ? { ...EMPTY_AIR_HANDLER_RUNTIME_STATE, ...JSON.parse(raw) }
        : { ...EMPTY_AIR_HANDLER_RUNTIME_STATE };
    },
    async set(airHandlerId, state) {
      await redis.set(`ah:${airHandlerId}:runtime`, JSON.stringify(state));
    },
  };
}

/** In-memory fake for functional tests. */
export function createInMemoryAirHandlerRuntimeStore(): AirHandlerRuntimeStore {
  const store = new Map<string, AirHandlerRuntimeState>();
  return {
    async get(airHandlerId) {
      return store.get(airHandlerId) ?? { ...EMPTY_AIR_HANDLER_RUNTIME_STATE };
    },
    async set(airHandlerId, state) {
      store.set(airHandlerId, state);
    },
  };
}
