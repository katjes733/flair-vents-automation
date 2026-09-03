/**
 * Exponential smoothing toward a new offset, clamped to a configurable
 * max — applies uniformly whether the input just changed because the
 * thermostat reading moved or because the tracked zone itself switched
 * (see "Driving setpoint selection"): no special-cased snap on a
 * zone-tracking switch, since that would reintroduce the abrupt,
 * potentially-padded-looking jump this smoothing exists to avoid.
 */
export function smoothOffset(params: {
  previousSmoothedOffset: number;
  rawOffset: number;
  alpha: number;
  maxAbsOffsetC: number;
}): number {
  const clampedRaw = Math.max(
    -params.maxAbsOffsetC,
    Math.min(params.maxAbsOffsetC, params.rawOffset),
  );
  const smoothed =
    params.previousSmoothedOffset +
    params.alpha * (clampedRaw - params.previousSmoothedOffset);
  return Math.max(
    -params.maxAbsOffsetC,
    Math.min(params.maxAbsOffsetC, smoothed),
  );
}
