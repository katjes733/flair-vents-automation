/** Clamps a vent position into a zone's configured [min,max] range. */
export function clampToZoneRange(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(Math.max(value, min), max);
}

/** Rounds to the nearest multiple of stepPct. A non-positive step is a no-op. */
export function quantizeToStep(value: number, stepPct: number): number {
  if (stepPct <= 0) return value;
  return Math.round(value / stepPct) * stepPct;
}

/**
 * clamp → quantize → re-clamp, in that order (see "Step 2 — quantization &
 * ramp limiting" in the implementation plan): quantizing a value near a
 * range boundary (e.g. 47% at a 10% step → 50%) can breach that boundary;
 * the final re-clamp is what closes that hole.
 */
export function clampQuantizeClamp(
  value: number,
  range: { min: number; max: number },
  stepPct: number,
): number {
  const preClamped = clampToZoneRange(value, range.min, range.max);
  const quantized = quantizeToStep(preClamped, stepPct);
  return clampToZoneRange(quantized, range.min, range.max);
}
