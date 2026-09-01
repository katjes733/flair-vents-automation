import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createInMemoryZoneDemandTrackingStore,
  EMPTY_ZONE_DEMAND_TRACKING_STATE,
} from "~/server/control/zoneDemandTrackingStore";

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("~/server/util/redis", () => ({ redis: { get, set } }));

const { createRedisZoneDemandTrackingStore } =
  await import("~/server/control/zoneDemandTrackingStore");

describe("createRedisZoneDemandTrackingStore", () => {
  beforeEach(() => {
    get.mockReset();
    set.mockReset();
  });

  it("returns the empty state when nothing is stored yet", async () => {
    get.mockResolvedValue(null);
    const store = createRedisZoneDemandTrackingStore();
    expect(await store.get("z1")).toEqual(EMPTY_ZONE_DEMAND_TRACKING_STATE);
    expect(get).toHaveBeenCalledWith("zone:z1:demandTracking");
  });

  it("parses a stored JSON blob, filling in any missing fields with defaults", async () => {
    get.mockResolvedValue(JSON.stringify({ demandStartedAtMs: 123 }));
    const store = createRedisZoneDemandTrackingStore();
    const result = await store.get("z1");
    expect(result.demandStartedAtMs).toBe(123);
    expect(result.worstDeviationAtDemandStart).toBe(null); // default filled in
  });

  it("writes via SET as a JSON blob", async () => {
    const store = createRedisZoneDemandTrackingStore();
    const state = {
      demandStartedAtMs: 123,
      worstDeviationAtDemandStart: 2.5,
      ductAnomalySinceMs: null,
    };
    await store.set("z1", state);
    expect(set).toHaveBeenCalledWith(
      "zone:z1:demandTracking",
      JSON.stringify(state),
    );
  });
});

describe("createInMemoryZoneDemandTrackingStore", () => {
  it("returns the empty state for a zone never written before", async () => {
    const store = createInMemoryZoneDemandTrackingStore();
    expect(await store.get("z1")).toEqual(EMPTY_ZONE_DEMAND_TRACKING_STATE);
  });

  it("round-trips whatever was last set", async () => {
    const store = createInMemoryZoneDemandTrackingStore();
    const state = {
      demandStartedAtMs: 100,
      worstDeviationAtDemandStart: 3,
      ductAnomalySinceMs: null,
    };
    await store.set("z1", state);
    expect(await store.get("z1")).toEqual(state);
  });
});
