import { describe, it, expect } from "vitest";
import { evaluateReconciliation } from "~/server/domain/dispatch/reconciliation";

const base = {
  targetPosition: 50,
  minStepDeltaPct: 15,
  attemptsSoFar: 0,
  maxAttempts: 3,
  dueForCheck: true,
};

describe("evaluateReconciliation", () => {
  it("waits when not yet due for a check", () => {
    expect(
      evaluateReconciliation({
        ...base,
        reportedPosition: null,
        dueForCheck: false,
      }),
    ).toEqual({ status: "pending" });
  });

  it("reconciles once the reported position matches within min_step_delta", () => {
    expect(evaluateReconciliation({ ...base, reportedPosition: 55 })).toEqual({
      status: "reconciled",
    });
  });

  it("retries, incrementing the attempt count, while under the max", () => {
    expect(
      evaluateReconciliation({
        ...base,
        reportedPosition: 10,
        attemptsSoFar: 1,
      }),
    ).toEqual({
      status: "retry",
      attempt: 2,
    });
  });

  it("degrades once attempts reach the max (the spec's stated 3 retries)", () => {
    expect(
      evaluateReconciliation({
        ...base,
        reportedPosition: 10,
        attemptsSoFar: 3,
      }),
    ).toEqual({
      status: "degraded",
    });
  });
});
