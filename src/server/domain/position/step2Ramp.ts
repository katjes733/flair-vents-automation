import { clampQuantizeClamp } from "~/server/domain/position/clamp";

export type DeadZoneRecoveryDirection = "open" | "close" | "both";

/**
 * Ramps from `lastCommandedTarget` (this app's own running target, not the
 * hardware's reported position — see "Step 2 — quantization & ramp
 * limiting") toward `desiredPosition`, bounded to at most
 * `modulationStepPct * maxStepsPerTick` per call. `null` origin (no prior
 * command yet) snaps directly to the desired position — there's no ramp
 * state to continue from. Order is clamp → quantize → re-clamp.
 *
 * The one other exception: a vent resting at a hard physical extreme
 * (0%/100%) that needs to move the other way jumps straight to
 * `deadZoneRecoveryJumpPct` instead of the normal step-capped delta —
 * confirmed on real hardware, Flair's vent motors can sit fully
 * unresponsive to an ordinary step-sized command for a stretch immediately
 * off either extreme, with no consistent/predictable width from one
 * occasion to the next (see docs/adr). Rather than crawl through however
 * many no-op ticks that turns out to be this time, this clears it in one
 * jump, even if that overshoots or undershoots `desiredPosition` — the
 * very next call ramps from the new origin toward the real target exactly
 * as normal, correcting in whichever direction is actually needed.
 * `deadZoneRecoveryJumpPct` is always a concrete resolved value by the
 * time it reaches here (the caller's own fallback, when the feature is
 * effectively off, is an ordinary max-size step) — this function itself
 * has no separate on/off switch for the jump *value*. `deadZoneRecoveryDirection`
 * gates which extreme(s) actually trigger it — "open" (leaving 0%),
 * "close" (leaving 100%), or "both" — added after real-world use showed
 * the two directions aren't symmetric in practice (see
 * dead_zone_recovery_direction's own comment, systemSettings.ts).
 */
export function rampTowardTarget(params: {
  desiredPosition: number;
  lastCommandedTarget: number | null;
  modulationStepPct: number;
  maxStepsPerTick: number;
  minVentPosition: number;
  maxVentPosition: number;
  deadZoneRecoveryJumpPct: number;
  deadZoneRecoveryDirection: DeadZoneRecoveryDirection;
}): number {
  const origin = params.lastCommandedTarget ?? params.desiredPosition;
  const leavingClosed =
    params.lastCommandedTarget === 0 &&
    (params.deadZoneRecoveryDirection === "open" ||
      params.deadZoneRecoveryDirection === "both");
  const leavingOpen =
    params.lastCommandedTarget === 100 &&
    (params.deadZoneRecoveryDirection === "close" ||
      params.deadZoneRecoveryDirection === "both");
  const leavingDeadZone =
    (leavingClosed || leavingOpen) &&
    params.desiredPosition !== params.lastCommandedTarget;
  let ramped: number;
  if (leavingDeadZone) {
    ramped = params.deadZoneRecoveryJumpPct;
  } else {
    const maxDelta = params.modulationStepPct * params.maxStepsPerTick;
    const delta = params.desiredPosition - origin;
    const boundedDelta = Math.sign(delta) * Math.min(Math.abs(delta), maxDelta);
    ramped = origin + boundedDelta;
  }
  return clampQuantizeClamp(
    ramped,
    { min: params.minVentPosition, max: params.maxVentPosition },
    params.modulationStepPct,
  );
}
