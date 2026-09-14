import { describe, it, expect } from "vitest";
import {
  shouldDispatch,
  detectDrift,
  isAtExtreme,
} from "~/server/domain/dispatch/stepDelta";

describe("isAtExtreme", () => {
  it("is true for an exact match at either extreme", () => {
    expect(isAtExtreme(0, 0, 100)).toBe(true);
    expect(isAtExtreme(100, 0, 100)).toBe(true);
  });

  // Regression coverage: a computed position can land a hair off a
  // zone's own configured extreme (e.g. 0.0021% instead of a clean 0)
  // once the pressure safeguard/capacity-sharing stages nudge it after
  // the ramp itself already quantized to a whole step.
  it("is true for a value within epsilon of an extreme", () => {
    expect(isAtExtreme(0.0021, 0, 100)).toBe(true);
    expect(isAtExtreme(99.8, 0, 100)).toBe(true);
  });

  it("is false for a value meaningfully away from either extreme", () => {
    expect(isAtExtreme(10, 0, 100)).toBe(false);
    expect(isAtExtreme(50, 0, 100)).toBe(false);
  });

  it("respects a zone's own configured range, not a hardcoded 0/100", () => {
    expect(isAtExtreme(20, 20, 80)).toBe(true);
    expect(isAtExtreme(50, 20, 80)).toBe(false);
  });
});

describe("shouldDispatch", () => {
  it("always dispatches the first command (no prior dispatched position)", () => {
    expect(
      shouldDispatch({
        targetPosition: 50,
        lastDispatchedPosition: null,
        minStepDeltaPct: 15,
        minPosition: 0,
        maxPosition: 100,
      }),
    ).toBe(true);
  });

  it("dispatches exactly at the min_step_delta boundary (>=, not >)", () => {
    expect(
      shouldDispatch({
        targetPosition: 65,
        lastDispatchedPosition: 50,
        minStepDeltaPct: 15,
        minPosition: 0,
        maxPosition: 100,
      }),
    ).toBe(true);
  });

  it("suppresses just under the boundary", () => {
    expect(
      shouldDispatch({
        targetPosition: 64,
        lastDispatchedPosition: 50,
        minStepDeltaPct: 15,
        minPosition: 0,
        maxPosition: 100,
      }),
    ).toBe(false);
  });

  it("compares against last-DISPATCHED, not the target itself trivially matching", () => {
    expect(
      shouldDispatch({
        targetPosition: 50,
        lastDispatchedPosition: 50,
        minStepDeltaPct: 15,
        minPosition: 0,
        maxPosition: 100,
      }),
    ).toBe(false);
  });

  // Regression coverage for a real, confirmed incident: a vent settled at
  // a reported 10% with its target computed at 0% for 5+ hours straight,
  // never dispatching because the 10-point delta from the last dispatch
  // never cleared the 15-point floor — while the room kept cooling the
  // whole time.
  describe("a target at either extreme bypasses the min-step floor", () => {
    it("dispatches a push to the fully-closed extreme even under the floor", () => {
      expect(
        shouldDispatch({
          targetPosition: 0,
          lastDispatchedPosition: 10,
          minStepDeltaPct: 15,
          minPosition: 0,
          maxPosition: 100,
        }),
      ).toBe(true);
    });

    it("dispatches a push to the fully-open extreme even under the floor", () => {
      expect(
        shouldDispatch({
          targetPosition: 100,
          lastDispatchedPosition: 92,
          minStepDeltaPct: 15,
          minPosition: 0,
          maxPosition: 100,
        }),
      ).toBe(true);
    });

    it("respects a zone's own configured range, not a hardcoded 0/100", () => {
      expect(
        shouldDispatch({
          targetPosition: 20, // this zone's own configured minimum
          lastDispatchedPosition: 28,
          minStepDeltaPct: 15,
          minPosition: 20,
          maxPosition: 80,
        }),
      ).toBe(true);
    });

    it("still suppresses a no-op when already sitting at the extreme", () => {
      expect(
        shouldDispatch({
          targetPosition: 0,
          lastDispatchedPosition: 0,
          minStepDeltaPct: 15,
          minPosition: 0,
          maxPosition: 100,
        }),
      ).toBe(false);
    });

    it("does not bypass the floor for a mid-range target, even a small one", () => {
      expect(
        shouldDispatch({
          targetPosition: 10,
          lastDispatchedPosition: 0,
          minStepDeltaPct: 15,
          minPosition: 0,
          maxPosition: 100,
        }),
      ).toBe(false);
    });

    it("dispatches a target that's only a hair off the extreme due to pipeline floating-point noise", () => {
      expect(
        shouldDispatch({
          targetPosition: 0.0021,
          lastDispatchedPosition: 10,
          minStepDeltaPct: 15,
          minPosition: 0,
          maxPosition: 100,
        }),
      ).toBe(true);
    });

    it("does not repeatedly redispatch two noisy values that are both already effectively at the extreme", () => {
      expect(
        shouldDispatch({
          targetPosition: 0.0035,
          lastDispatchedPosition: 0.002,
          minStepDeltaPct: 15,
          minPosition: 0,
          maxPosition: 100,
        }),
      ).toBe(false);
    });
  });
});

describe("detectDrift", () => {
  it("flags drift once the reported position diverges from the last target by the threshold", () => {
    expect(
      detectDrift({
        reportedPosition: 65,
        lastTargetPosition: 50,
        minStepDeltaPct: 15,
      }),
    ).toBe(true);
  });

  it("does not flag a small divergence under the threshold", () => {
    expect(
      detectDrift({
        reportedPosition: 55,
        lastTargetPosition: 50,
        minStepDeltaPct: 15,
      }),
    ).toBe(false);
  });
});
