export type ReconciliationOutcome =
  | { status: "pending" }
  | { status: "reconciled" }
  | { status: "retry"; attempt: number }
  | { status: "degraded" };

/**
 * Pure wait → retry×3 (the spec's stated count) → degrade state machine.
 * See "Reconciliation & startup reconciliation".
 */
export function evaluateReconciliation(params: {
  targetPosition: number;
  reportedPosition: number | null;
  minStepDeltaPct: number;
  attemptsSoFar: number;
  maxAttempts: number;
  dueForCheck: boolean;
}): ReconciliationOutcome {
  if (!params.dueForCheck) return { status: "pending" };
  if (
    params.reportedPosition !== null &&
    Math.abs(params.reportedPosition - params.targetPosition) <
      params.minStepDeltaPct
  ) {
    return { status: "reconciled" };
  }
  if (params.attemptsSoFar >= params.maxAttempts) {
    return { status: "degraded" };
  }
  return { status: "retry", attempt: params.attemptsSoFar + 1 };
}
