import { describe, it, expect, vi, beforeEach } from "vitest";
import { logSpy } from "../../../setup";

const { get, set } = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("~/server/util/redis", () => ({ redis: { get, set } }));

const { createOutageTracker } = await import("~/server/util/flair/outage");

// A tiny in-memory stand-in for what the mocked redis.get/set actually
// store, so each test can drive the tracker through a real sequence of
// failures/recoveries without hand-writing the JSON at every step.
function wireFakeRedis() {
  let stored: string | null = null;
  get.mockImplementation(async () => stored);
  set.mockImplementation(async (_key: string, value: string) => {
    stored = value;
  });
}

beforeEach(() => {
  get.mockReset();
  set.mockReset();
  wireFakeRedis();
});

describe("createOutageTracker", () => {
  it("starts not failing", async () => {
    expect((await createOutageTracker("inst-1").getState()).failing).toBe(
      false,
    );
  });

  it("logs 'Flair outage detected' exactly once across repeated failures", async () => {
    const tracker = createOutageTracker("inst-1");
    await tracker.recordFailure(1000);
    await tracker.recordFailure(2000);
    await tracker.recordFailure(3000);
    expect((await tracker.getState()).failing).toBe(true);
    const detectedCalls = (
      logSpy("error") as ReturnType<typeof logSpy>
    ).mock.calls.filter((c) => c[0] === "Flair outage detected");
    expect(detectedCalls).toHaveLength(1);
  });

  it("logs 'Flair outage cleared' with the outage duration on recovery", async () => {
    const tracker = createOutageTracker("inst-1");
    await tracker.recordFailure(1000);
    await tracker.recordSuccess(6000);
    expect((await tracker.getState()).failing).toBe(false);
    expect(logSpy("info")).toHaveBeenCalledWith(
      { outage_duration_s: 5 },
      "Flair outage cleared",
    );
  });

  it("does not log 'cleared' when recordSuccess is called while already healthy", async () => {
    const tracker = createOutageTracker("inst-1");
    await tracker.recordSuccess(1000);
    expect(logSpy("info")).not.toHaveBeenCalled();
  });

  it("getState().sinceMs is null when healthy", async () => {
    expect((await createOutageTracker("inst-1").getState()).sinceMs).toBe(null);
  });

  it("getState().sinceMs reports the start of the current outage, not the latest failure", async () => {
    const tracker = createOutageTracker("inst-1");
    await tracker.recordFailure(1000);
    await tracker.recordFailure(2000);
    await tracker.recordFailure(3000);
    expect((await tracker.getState()).sinceMs).toBe(1000);
  });

  it("getState().sinceMs resets to null once recovered", async () => {
    const tracker = createOutageTracker("inst-1");
    await tracker.recordFailure(1000);
    await tracker.recordSuccess(2000);
    expect((await tracker.getState()).sinceMs).toBe(null);
  });

  it("can detect a second outage after recovering from the first", async () => {
    const tracker = createOutageTracker("inst-1");
    await tracker.recordFailure(1000);
    await tracker.recordSuccess(2000);
    await tracker.recordFailure(3000);
    const detectedCalls = (
      logSpy("error") as ReturnType<typeof logSpy>
    ).mock.calls.filter((c) => c[0] === "Flair outage detected");
    expect(detectedCalls).toHaveLength(2);
  });

  it("state persists across independently-constructed trackers for the same installation (the point of moving it to Redis)", async () => {
    await createOutageTracker("inst-1").recordFailure(1000);
    const secondTracker = createOutageTracker("inst-1");
    expect((await secondTracker.getState()).failing).toBe(true);
  });
});
