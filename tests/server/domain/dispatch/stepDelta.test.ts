import { describe, it, expect } from "vitest";
import {
  shouldDispatch,
  detectDrift,
} from "~/server/domain/dispatch/stepDelta";

describe("shouldDispatch", () => {
  it("always dispatches the first command (no prior dispatched position)", () => {
    expect(
      shouldDispatch({
        targetPosition: 50,
        lastDispatchedPosition: null,
        minStepDeltaPct: 15,
      }),
    ).toBe(true);
  });

  it("dispatches exactly at the min_step_delta boundary (>=, not >)", () => {
    expect(
      shouldDispatch({
        targetPosition: 65,
        lastDispatchedPosition: 50,
        minStepDeltaPct: 15,
      }),
    ).toBe(true);
  });

  it("suppresses just under the boundary", () => {
    expect(
      shouldDispatch({
        targetPosition: 64,
        lastDispatchedPosition: 50,
        minStepDeltaPct: 15,
      }),
    ).toBe(false);
  });

  it("compares against last-DISPATCHED, not the target itself trivially matching", () => {
    expect(
      shouldDispatch({
        targetPosition: 50,
        lastDispatchedPosition: 50,
        minStepDeltaPct: 15,
      }),
    ).toBe(false);
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
