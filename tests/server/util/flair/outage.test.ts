import { describe, it, expect } from "vitest";
import { createOutageTracker } from "~/server/util/flair/outage";
import { logSpy } from "../../../setup";

describe("createOutageTracker", () => {
  it("starts not failing", () => {
    expect(createOutageTracker("inst-1").isFailing()).toBe(false);
  });

  it("logs 'Flair outage detected' exactly once across repeated failures", () => {
    const tracker = createOutageTracker("inst-1");
    tracker.recordFailure(1000);
    tracker.recordFailure(2000);
    tracker.recordFailure(3000);
    expect(tracker.isFailing()).toBe(true);
    const detectedCalls = (
      logSpy("error") as ReturnType<typeof logSpy>
    ).mock.calls.filter((c) => c[0] === "Flair outage detected");
    expect(detectedCalls).toHaveLength(1);
  });

  it("logs 'Flair outage cleared' with the outage duration on recovery", () => {
    const tracker = createOutageTracker("inst-1");
    tracker.recordFailure(1000);
    tracker.recordSuccess(6000);
    expect(tracker.isFailing()).toBe(false);
    expect(logSpy("info")).toHaveBeenCalledWith(
      { outage_duration_s: 5 },
      "Flair outage cleared",
    );
  });

  it("does not log 'cleared' when recordSuccess is called while already healthy", () => {
    const tracker = createOutageTracker("inst-1");
    tracker.recordSuccess(1000);
    expect(logSpy("info")).not.toHaveBeenCalled();
  });

  it("can detect a second outage after recovering from the first", () => {
    const tracker = createOutageTracker("inst-1");
    tracker.recordFailure(1000);
    tracker.recordSuccess(2000);
    tracker.recordFailure(3000);
    const detectedCalls = (
      logSpy("error") as ReturnType<typeof logSpy>
    ).mock.calls.filter((c) => c[0] === "Flair outage detected");
    expect(detectedCalls).toHaveLength(2);
  });
});
