import { describe, it, expect, vi } from "vitest";
import {
  computeStartupReconciliation,
  runStartupReconciliation,
} from "~/server/control/startupReconcile";
import { createInMemoryReconciliationQueue } from "~/server/control/reconciliationQueue";

function fakeLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as never;
}

describe("computeStartupReconciliation", () => {
  it("seeds the ramp origin from the reported position for every zone with one", () => {
    const result = computeStartupReconciliation([
      {
        zoneId: "z1",
        vents: [{ flairVentId: "v1", reportedPosition: 42 }],
        lastTargetPosition: 42,
        minStepDeltaPct: 15,
      },
    ]);
    expect(result.seedLastCommandedTarget.get("z1")).toBe(42);
  });

  it("flags a genuine mismatch against the persisted pre-restart target, not just adopting reality as correct", () => {
    const result = computeStartupReconciliation([
      {
        zoneId: "z1",
        vents: [{ flairVentId: "v1", reportedPosition: 10 }],
        lastTargetPosition: 80,
        minStepDeltaPct: 15,
      },
    ]);
    expect(result.mismatches).toEqual([{ zoneId: "z1", flairVentId: "v1" }]);
  });

  it("drops stale reconciliations with no persisted target to compare against", () => {
    const result = computeStartupReconciliation([
      {
        zoneId: "z1",
        vents: [{ flairVentId: "v1", reportedPosition: 10 }],
        lastTargetPosition: null,
        minStepDeltaPct: 15,
      },
    ]);
    expect(result.mismatches).toEqual([]);
  });

  it("skips a zone with no reported position at all", () => {
    const result = computeStartupReconciliation([
      {
        zoneId: "z1",
        vents: [{ flairVentId: "v1", reportedPosition: null }],
        lastTargetPosition: 50,
        minStepDeltaPct: 15,
      },
    ]);
    expect(result.seedLastCommandedTarget.has("z1")).toBe(false);
  });

  it("seeds a 2-vent zone with the minimum reported position across its vents, and flags each vent's own mismatch independently", () => {
    const result = computeStartupReconciliation([
      {
        zoneId: "z1",
        vents: [
          { flairVentId: "v1", reportedPosition: 40 },
          { flairVentId: "v2", reportedPosition: 10 },
        ],
        lastTargetPosition: 80,
        minStepDeltaPct: 15,
      },
    ]);
    expect(result.seedLastCommandedTarget.get("z1")).toBe(10);
    expect(result.mismatches).toEqual(
      expect.arrayContaining([
        { zoneId: "z1", flairVentId: "v1" },
        { zoneId: "z1", flairVentId: "v2" },
      ]),
    );
    expect(result.mismatches).toHaveLength(2);
  });
});

describe("runStartupReconciliation", () => {
  it("enqueues an immediate reconciliation check for each mismatch, and dispatches nothing itself", async () => {
    const queue = createInMemoryReconciliationQueue();
    await runStartupReconciliation({
      log: fakeLog(),
      airHandlerId: "ah-1",
      zones: [
        {
          zoneId: "z1",
          vents: [{ flairVentId: "v1", reportedPosition: 10 }],
          lastTargetPosition: 80,
          minStepDeltaPct: 15,
        },
      ],
      reconciliationQueue: queue,
      nowMs: 1000,
    });
    expect(await queue.dequeueDue(1000)).toEqual(["z1:v1"]);
  });
});
