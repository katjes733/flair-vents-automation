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
  // The same value step1DesiredPosition.ts's demand floor scales from —
  // see the second bypass clause below for why this is needed alongside
  // the extreme-only one above it. A caller with no meaningful concept of
  // an idle baseline (the fail-safe path, which already passes
  // minStepDeltaPct: 0 and never reaches either bypass clause) can pass
  // either extreme; it's inert there either way.
  idleBaselinePosition: number;
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
  if (
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
  ) {
    return true;
  }
  // A real, confirmed gap this fixes: step1DesiredPosition.ts's demand
  // floor guarantees a barely-demanding zone's *computed* target clears
  // idleBaselinePosition (never literally 0 while genuinely demanding),
  // but that guarantee was purely cosmetic if the resulting target still
  // couldn't clear minStepDeltaPct from a last dispatch sitting AT idle
  // baseline — a zone stuck at 10% target / confirmed-resting reported
  // position, "holding" forever whenever demand stays marginal, would
  // have to fall back on the much slower demand-stall detector to ever
  // get real airflow, even though nothing about this transition is
  // ambiguous or noise-prone: crossing from "resting" to "genuinely
  // trying" is exactly as decisive as landing on an extreme is above, and
  // deserves the same unconditional dispatch. Guarded the same way the
  // extreme clause is (only fires while the last dispatch hasn't already
  // crossed too), so it can't cause a redispatch loop once the vent
  // actually reflects the floor.
  return (
    params.targetPosition > params.idleBaselinePosition &&
    params.lastDispatchedPosition <= params.idleBaselinePosition
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
