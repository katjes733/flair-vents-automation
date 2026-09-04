import { describe, it, expect, vi } from "vitest";
import { dispatchZoneCommand } from "~/server/control/dispatcher";
import { createInMemoryReconciliationQueue } from "~/server/control/reconciliationQueue";
import { FakeFlairClient } from "../../helpers/fakeFlairClient";

function fakeLog() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as never;
}

describe("dispatchZoneCommand", () => {
  it("dispatches and enqueues reconciliation when the step-delta threshold is met", async () => {
    const client = new FakeFlairClient();
    const queue = createInMemoryReconciliationQueue();
    const result = await dispatchZoneCommand({
      log: fakeLog(),
      client,
      airHandlerId: "ah-1",
      zoneId: "z1",
      ventId: "vent-1",
      targetPosition: 80,
      lastDispatchedPosition: 50,
      reportedPosition: 50,
      minStepDeltaPct: 15,
      reconciliationQueue: queue,
      nowMs: 1000,
      actuationDelayMs: 60000,
      dryRun: false,
    });
    expect(result).toEqual({
      dispatched: true,
      lastDispatchedPosition: 80,
      stepDeltaPct: 30,
    });
    expect(client.getVentCommandHistory()).toHaveLength(1);
    expect(await queue.dequeueDue(61000)).toEqual(["z1:vent-1"]);
  });

  it("suppresses under the step-delta threshold and never calls the client", async () => {
    const client = new FakeFlairClient();
    const queue = createInMemoryReconciliationQueue();
    const result = await dispatchZoneCommand({
      log: fakeLog(),
      client,
      airHandlerId: "ah-1",
      zoneId: "z1",
      ventId: "vent-1",
      targetPosition: 55,
      lastDispatchedPosition: 50,
      reportedPosition: 50,
      minStepDeltaPct: 15,
      reconciliationQueue: queue,
      nowMs: 1000,
      actuationDelayMs: 60000,
      dryRun: false,
    });
    expect(result.dispatched).toBe(false);
    // stepDeltaPct is still reported on a suppressed dispatch — it's what
    // lets the UI show "how close to actually moving" even when nothing
    // was sent this tick. See formatDispatchStatus.
    expect(result.stepDeltaPct).toBe(5);
    expect(client.getVentCommandHistory()).toHaveLength(0);
  });

  it("in dry_run mode, computes the same decision but never calls the client or enqueues reconciliation", async () => {
    const client = new FakeFlairClient();
    const queue = createInMemoryReconciliationQueue();
    const result = await dispatchZoneCommand({
      log: fakeLog(),
      client,
      airHandlerId: "ah-1",
      zoneId: "z1",
      ventId: "vent-1",
      targetPosition: 80,
      lastDispatchedPosition: 50,
      reportedPosition: 50,
      minStepDeltaPct: 15,
      reconciliationQueue: queue,
      nowMs: 1000,
      actuationDelayMs: 60000,
      dryRun: true,
    });
    expect(result.dispatched).toBe(true);
    expect(client.getVentCommandHistory()).toHaveLength(0);
    expect(await queue.dequeueDue(61000)).toEqual([]);
  });
});
