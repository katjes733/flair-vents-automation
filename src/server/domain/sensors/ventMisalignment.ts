import type { HvacCallState, ZoneClassification } from "~/server/domain/types";

export interface VentMisalignmentState {
  windowSinceMs: number | null;
  windowStartTempC: number | null;
  recalibratingSinceMs: number | null;
  lastRecalibratedAtMs: number | null;
}

export const EMPTY_VENT_MISALIGNMENT_STATE: VentMisalignmentState = {
  windowSinceMs: null,
  windowStartTempC: null,
  recalibratingSinceMs: null,
  lastRecalibratedAtMs: null,
};

export type VentMisalignmentAction =
  | { kind: "none" }
  | { kind: "force_open" }
  | { kind: "recalibration_finished"; outcome: "opened" | "timed_out" };

export interface VentMisalignmentEvaluation {
  next: VentMisalignmentState;
  action: VentMisalignmentAction;
  // Surfaced in the tick decision independent of `action` — true for the
  // whole stretch from the tick that first crossed the temp threshold
  // through the tick the home cycle finishes, not just the one instant
  // detection fired.
  suspected: boolean;
}

/**
 * Vent misalignment auto-recalibration — see
 * vent_misalignment_auto_recalibration_enabled's own comment
 * (systemSettings.ts) for the real, confirmed live problem this exists
 * for: `percent-open` is an accumulated motor estimate (see
 * docs/flair-api-schema.md), not a true position sensor, so a vent
 * reported at 0% (believed fully closed) can genuinely sit open with no
 * software signal to notice — except the room it serves still tracking
 * whichever direction the system is actively calling, in lockstep with
 * the call's own on/off cycling. A sealed vent shouldn't care whether the
 * compressor is running.
 *
 * Detection window: anchored the instant a zone is simultaneously (a)
 * every vent reporting exactly 0%, (b) classified `satisfied` — a
 * genuinely `demanding` zone's own dispatch gap is the separate,
 * already-fixed sleep-mode-threshold problem, not this one — and (c) the
 * system is actively calling (COOLING_CALL/HEATING_CALL). Reset the
 * instant any of those three breaks: an idle-segment rebound is normal
 * for every zone, sealed or not, so only the temp response *within one
 * uninterrupted call segment* is diagnostic. Flags once the zone has
 * moved by `tempThresholdC` in the call's own direction since the window
 * opened (colder during COOLING_CALL, warmer during HEATING_CALL).
 *
 * Correction: a full home cycle rather than a diagnosis-only alert — an
 * occasional deliberate open/close is cheaper than a vent silently stuck
 * open all night. `force_open` is returned every tick the cycle is still
 * waiting for the vent to actually report itself open; the caller is
 * responsible for actually commanding 100% while that's the action.
 * `maxOpenWaitMs` bounds how long that wait can run — a vent with a
 * genuinely stuck/disconnected motor shouldn't hold its zone open
 * indefinitely — and either a real open or a timeout starts
 * `cooldownMs`, so a persistently-faulty vent isn't retried every tick.
 */
export function evaluateVentMisalignment(params: {
  nowMs: number;
  // Only meaningful (as a call direction) while `callActive` — pass
  // ARBITRARY_IDLE_CALL_STATE (or any HvacCallState) while idle, mirroring
  // pipeline.ts's own convention; it's never actually read in that case,
  // since `trackingActive` below is already false whenever `!callActive`.
  hvacState: HvacCallState;
  callActive: boolean;
  classification: ZoneClassification | "inactive";
  allVentsReportedClosed: boolean;
  allVentsReportedOpenEnough: boolean;
  calibratedTempC: number | null;
  prior: VentMisalignmentState;
  tempThresholdC: number;
  cooldownMs: number;
  maxOpenWaitMs: number;
}): VentMisalignmentEvaluation {
  const { prior } = params;

  if (prior.recalibratingSinceMs !== null) {
    const waitedMs = params.nowMs - prior.recalibratingSinceMs;
    const timedOut = waitedMs >= params.maxOpenWaitMs;
    if (params.allVentsReportedOpenEnough || timedOut) {
      return {
        next: {
          windowSinceMs: null,
          windowStartTempC: null,
          recalibratingSinceMs: null,
          lastRecalibratedAtMs: params.nowMs,
        },
        action: {
          kind: "recalibration_finished",
          outcome: params.allVentsReportedOpenEnough ? "opened" : "timed_out",
        },
        suspected: false,
      };
    }
    return { next: prior, action: { kind: "force_open" }, suspected: true };
  }

  const inCooldown =
    prior.lastRecalibratedAtMs !== null &&
    params.nowMs - prior.lastRecalibratedAtMs < params.cooldownMs;
  if (inCooldown) {
    return {
      next: {
        ...EMPTY_VENT_MISALIGNMENT_STATE,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      },
      action: { kind: "none" },
      suspected: false,
    };
  }

  const trackingActive =
    params.callActive &&
    params.allVentsReportedClosed &&
    params.classification === "satisfied";
  if (!trackingActive) {
    return {
      next: {
        ...EMPTY_VENT_MISALIGNMENT_STATE,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      },
      action: { kind: "none" },
      suspected: false,
    };
  }

  if (prior.windowSinceMs === null || prior.windowStartTempC === null) {
    if (params.calibratedTempC === null) {
      // Nothing to anchor the window against yet — wait for a real reading.
      return {
        next: prior,
        action: { kind: "none" },
        suspected: false,
      };
    }
    return {
      next: {
        windowSinceMs: params.nowMs,
        windowStartTempC: params.calibratedTempC,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      },
      action: { kind: "none" },
      suspected: false,
    };
  }

  if (params.calibratedTempC === null) {
    return { next: prior, action: { kind: "none" }, suspected: false };
  }

  const deltaC = params.calibratedTempC - prior.windowStartTempC;
  const suspicious =
    params.hvacState === "COOLING_CALL"
      ? deltaC <= -params.tempThresholdC
      : deltaC >= params.tempThresholdC;

  if (!suspicious) {
    return { next: prior, action: { kind: "none" }, suspected: false };
  }

  return {
    next: {
      windowSinceMs: prior.windowSinceMs,
      windowStartTempC: prior.windowStartTempC,
      recalibratingSinceMs: params.nowMs,
      lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
    },
    action: { kind: "force_open" },
    suspected: true,
  };
}

/**
 * A "quick view" per-zone counter (dashboard badge) — how many
 * recalibration cycles (either outcome; a timed-out attempt is still the
 * detector firing, just as worth surfacing as a completed one) finished
 * within the trailing `windowMs`. Deliberately a plain rolling count, not
 * a lifetime total — a zone that recalibrated three times last month and
 * hasn't since shouldn't still show "3" today. Kept separate from
 * evaluateVentMisalignment itself (which owns the window/cooldown state
 * machine) since this is a different, independent concern — an audit
 * trail for a human, not a control-loop input — and every call site
 * needs it regardless of which branch that function took this tick.
 * Deeper analysis (which zone, what time of day, how long each open took)
 * is expected to come from the existing structured Loki events
 * (logVentMisalignmentRecalibration) instead of this count, which exists
 * only to answer "is this actively happening to this zone right now."
 */
export function updateRecalibrationHistory(params: {
  priorHistoryMs: readonly number[];
  nowMs: number;
  windowMs: number;
  // Pass `nowMs` the tick a cycle finishes (either outcome), `null` every
  // other tick.
  justCompletedMs: number | null;
}): number[] {
  const cutoffMs = params.nowMs - params.windowMs;
  const pruned = params.priorHistoryMs.filter((ms) => ms > cutoffMs);
  return params.justCompletedMs !== null
    ? [...pruned, params.justCompletedMs]
    : pruned;
}
