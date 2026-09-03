/**
 * Suppresses a dispatch when the change from the last *dispatched*
 * position (not the last target, and not the reported position) is
 * smaller than the configured threshold — see "Resolved Design Decisions"
 * for why this operand choice was necessary to avoid a deadlock with the
 * ramp step size.
 */
export function shouldDispatch(params: {
  targetPosition: number;
  lastDispatchedPosition: number | null;
  minStepDeltaPct: number;
}): boolean {
  if (params.lastDispatchedPosition === null) return true;
  return (
    Math.abs(params.targetPosition - params.lastDispatchedPosition) >=
    params.minStepDeltaPct
  );
}

/**
 * The periodic drift-check backstop (every driftCheckIntervalTicks) that
 * comparing against last-dispatched (instead of reported) removed:
 * compares reported position against last_target_position, independent of
 * any pending reconciliation.
 */
export function detectDrift(params: {
  reportedPosition: number;
  lastTargetPosition: number;
  minStepDeltaPct: number;
}): boolean {
  return (
    Math.abs(params.reportedPosition - params.lastTargetPosition) >=
    params.minStepDeltaPct
  );
}
