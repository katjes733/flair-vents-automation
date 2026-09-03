import { clampQuantizeClamp } from "~/server/domain/position/clamp";

/**
 * Ramps from `lastCommandedTarget` (this app's own running target, not the
 * hardware's reported position — see "Step 2 — quantization & ramp
 * limiting") toward `desiredPosition`, bounded to at most
 * `modulationStepPct * maxStepsPerTick` per call. `null` origin (no prior
 * command yet) snaps directly to the desired position — there's no ramp
 * state to continue from. Order is clamp → quantize → re-clamp.
 */
export function rampTowardTarget(params: {
  desiredPosition: number;
  lastCommandedTarget: number | null;
  modulationStepPct: number;
  maxStepsPerTick: number;
  minVentPosition: number;
  maxVentPosition: number;
}): number {
  const origin = params.lastCommandedTarget ?? params.desiredPosition;
  const maxDelta = params.modulationStepPct * params.maxStepsPerTick;
  const delta = params.desiredPosition - origin;
  const boundedDelta = Math.sign(delta) * Math.min(Math.abs(delta), maxDelta);
  const ramped = origin + boundedDelta;
  return clampQuantizeClamp(
    ramped,
    { min: params.minVentPosition, max: params.maxVentPosition },
    params.modulationStepPct,
  );
}
