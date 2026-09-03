import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createInMemoryAirHandlerRuntimeStore,
  EMPTY_AIR_HANDLER_RUNTIME_STATE,
} from "~/server/control/airHandlerRuntimeStore";

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("~/server/util/redis", () => ({ redis: { get, set } }));

const { createRedisAirHandlerRuntimeStore } =
  await import("~/server/control/airHandlerRuntimeStore");

describe("createRedisAirHandlerRuntimeStore", () => {
  beforeEach(() => {
    get.mockReset();
    set.mockReset();
  });

  it("returns the empty state when nothing is stored yet", async () => {
    get.mockResolvedValue(null);
    const store = createRedisAirHandlerRuntimeStore();
    expect(await store.get("ah-1")).toEqual(EMPTY_AIR_HANDLER_RUNTIME_STATE);
    expect(get).toHaveBeenCalledWith("ah:ah-1:runtime");
  });

  it("parses a stored JSON blob, filling in any missing fields with defaults", async () => {
    get.mockResolvedValue(JSON.stringify({ trackedDrivingZoneId: "z1" }));
    const store = createRedisAirHandlerRuntimeStore();
    const result = await store.get("ah-1");
    expect(result.trackedDrivingZoneId).toBe("z1");
    expect(result.smoothedOffsetC).toBe(0); // default filled in
  });

  it("writes via SET as a JSON blob", async () => {
    const store = createRedisAirHandlerRuntimeStore();
    const state = { ...EMPTY_AIR_HANDLER_RUNTIME_STATE, smoothedOffsetC: 1.5 };
    await store.set("ah-1", state);
    expect(set).toHaveBeenCalledWith("ah:ah-1:runtime", JSON.stringify(state));
  });
});

describe("createInMemoryAirHandlerRuntimeStore", () => {
  it("returns the empty state for an air handler never written before", async () => {
    const store = createInMemoryAirHandlerRuntimeStore();
    expect(await store.get("ah-1")).toEqual(EMPTY_AIR_HANDLER_RUNTIME_STATE);
  });

  it("round-trips whatever was last set", async () => {
    const store = createInMemoryAirHandlerRuntimeStore();
    const state = {
      trackedDrivingZoneId: "z1",
      ticksSinceLeadChanged: 3,
      smoothedOffsetC: 1.2,
      lastPushedSetpointC: 21.5,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: 1704110400000,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      worstDeviationAtCallStartC: null,
      ticksSinceDriftCheck: 0,
    };
    await store.set("ah-1", state);
    expect(await store.get("ah-1")).toEqual(state);
  });

  it("keeps air handlers independent", async () => {
    const store = createInMemoryAirHandlerRuntimeStore();
    await store.set("ah-1", {
      trackedDrivingZoneId: "z1",
      ticksSinceLeadChanged: 1,
      smoothedOffsetC: 0.5,
      lastPushedSetpointC: 21,
      lastHvacState: "COOLING_CALL",
      callStartedAtMs: 1704110400000,
      equipmentFaultActive: false,
      equipmentFaultClearDwellSinceMs: null,
      worstDeviationAtCallStartC: null,
      ticksSinceDriftCheck: 0,
    });
    expect(await store.get("ah-2")).toEqual(EMPTY_AIR_HANDLER_RUNTIME_STATE);
  });
});
