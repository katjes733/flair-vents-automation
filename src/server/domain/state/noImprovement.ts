// A snapshot-vs-now comparison, deliberately simple: record the worst
// deviation at the moment a call/demand period starts, and once the
// configured alert duration has elapsed, alert if the current worst
// deviation hasn't shrunk by more than a small margin from that snapshot.
// Shared by both "HVAC extended call with no improvement" (whole air
// handler) and "Zone demand with no improvement" (single zone) — same
// math, different scope of what "worst deviation" is computed over.
//
// A small margin, not a bare `>=`, so trivial sensor noise around an
// already-converged value doesn't itself read as "no improvement" —
// roughly the same noise-floor magnitude already used elsewhere for
// sensor-level comparisons (sensor_disagreement_threshold_c defaults to
// 0.56°C). PLACEHOLDER pending real-world tuning.
export const NO_IMPROVEMENT_MARGIN_C = 0.5;

export function detectNoImprovement(params: {
  worstDeviationAtStart: number | null;
  currentWorstDeviation: number;
  durationMinutes: number;
  alertMinutes: number;
}): boolean {
  if (params.worstDeviationAtStart === null) return false;
  if (params.durationMinutes < params.alertMinutes) return false;
  return (
    params.currentWorstDeviation >=
    params.worstDeviationAtStart - NO_IMPROVEMENT_MARGIN_C
  );
}
