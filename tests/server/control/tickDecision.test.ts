import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AirHandlerTickDecision } from "~/server/control/tickDecision";

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("~/server/util/redis", () => ({ redis: { get, set } }));

const { cacheTickDecision, getCachedTickDecision } =
  await import("~/server/control/tickDecision");

function decision(
  overrides: Partial<AirHandlerTickDecision> = {},
): AirHandlerTickDecision {
  return {
    air_handler_id: "ah-1",
    tick_at: "2024-01-01T00:00:00.000Z",
    duration_ms: 10,
    dry_run: false,
    control_disarmed: false,
    equipment_fault_active: false,
    hvac_state: "IDLE",
    call_confidence: "reported",
    zones: [],
    contention: null,
    pressure: null,
    driving_zone: null,
    setpoint_push: null,
    narrative: "nothing happening",
    ...overrides,
  };
}

// A tiny in-memory stand-in for what the mocked redis.get/set actually
// store, so a set followed by a get in the same test behaves like the
// real thing without hand-writing JSON at every step.
function wireFakeRedis() {
  const store = new Map<string, string>();
  get.mockImplementation(async (key: string) => store.get(key) ?? null);
  set.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
}

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  wireFakeRedis();
});

describe("tick decision cache", () => {
  it("returns null for an air handler that hasn't ticked yet", async () => {
    expect(await getCachedTickDecision("never-ticked")).toBeNull();
  });

  it("caches and overwrites per air handler, one entry each", async () => {
    await cacheTickDecision(
      decision({ air_handler_id: "ah-x", narrative: "first" }),
    );
    await cacheTickDecision(
      decision({ air_handler_id: "ah-x", narrative: "second" }),
    );
    expect((await getCachedTickDecision("ah-x"))?.narrative).toBe("second");
  });

  it("keeps air handlers independent, keyed by id", async () => {
    await cacheTickDecision(
      decision({ air_handler_id: "ah-a", narrative: "for a" }),
    );
    await cacheTickDecision(
      decision({ air_handler_id: "ah-b", narrative: "for b" }),
    );
    expect((await getCachedTickDecision("ah-a"))?.narrative).toBe("for a");
    expect((await getCachedTickDecision("ah-b"))?.narrative).toBe("for b");
  });

  it("state persists across independent reads — the point of moving it to Redis instead of an in-memory Map", async () => {
    // Simulates the real Stage 6 shape: one "process" (worker) writes the
    // decision, a different "process" (the API server) reads it back —
    // both against the same shared Redis, unlike an in-memory Map which
    // would only ever be visible within the process that wrote it.
    await cacheTickDecision(decision({ air_handler_id: "ah-1" }));
    const readBack = await getCachedTickDecision("ah-1");
    expect(readBack).not.toBeNull();
    expect(get).toHaveBeenCalledWith("tickDecision:ah-1");
  });
});
