// A computed position can land a hair off a zone's own configured
// extreme (e.g. 0.0021% instead of a clean 0) once the pressure
// safeguard/capacity-sharing stages nudge it after the ramp itself
// already quantized to a whole step — confirmed live via a test fixture
// exercising a near-empty minimum_aggregate_flow_lps floor. Exact `===`
// would silently miss "this is effectively the extreme" in exactly the
// case that matters most; anything this close is indistinguishable from
// the extreme at real vent-motor precision anyway.
const EXTREME_EPSILON_PCT = 0.5;

export function isAtExtreme(
  position: number,
  minPosition: number,
  maxPosition: number,
): boolean {
  return (
    Math.abs(position - minPosition) < EXTREME_EPSILON_PCT ||
    Math.abs(position - maxPosition) < EXTREME_EPSILON_PCT
  );
}

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
  // The zone's own configured vent-position range (not a hardcoded 0/100
  // — a zone can be configured with a narrower range via
  // min_vent_position/max_vent_position). A real, confirmed incident: a
  // vent settled at a reported 10% with its computed target sitting at
  // its zone's own fully-closed extreme for 5+ hours straight, never
  // dispatching because the 10-point delta from the last dispatch never
  // cleared the 15-point floor — while the room kept cooling the whole
  // time, because the vent never physically closed further. A target at
  // either extreme is never ambiguous — there's no comfort-noise tradeoff
  // to protect by holding back an already-committed "fully open"/"fully
  // closed" decision, unlike a mid-range value where the floor exists
  // specifically to avoid noisy tiny corrections.
  minPosition: number;
  maxPosition: number;
}): boolean {
  if (params.lastDispatchedPosition === null) return true;
  const meetsFloor =
    Math.abs(params.targetPosition - params.lastDispatchedPosition) >=
    params.minStepDeltaPct;
  if (meetsFloor) return true;
  // Only reached once the plain floor check already said no — still lets
  // a target at either extreme through, unless the last dispatch was
  // *already* effectively at that same extreme (a genuine no-op, not a
  // real correction still needed) — comparing "near an extreme" on both
  // sides rather than exact equality, so two floating-point-noisy values
  // that are both already effectively at the floor don't repeatedly
  // redispatch each other forever. A caller that passes minStepDeltaPct:
  // 0 to bypass the suppressor entirely (fail-safe, the idle-baseline
  // hold) never reaches this branch at all, since meetsFloor is always
  // true for them regardless of position — this only changes behavior
  // for a real, nonzero floor.
  return (
    isAtExtreme(
      params.targetPosition,
      params.minPosition,
      params.maxPosition,
    ) &&
    !isAtExtreme(
      params.lastDispatchedPosition,
      params.minPosition,
      params.maxPosition,
    )
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
