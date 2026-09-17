import type { HvacCallState, ZoneClassification } from "~/server/domain/types";

// Which source started the currently-running (or most recently finished)
// cycle — a manual trigger is an explicit maintenance action, not the
// detector noticing a problem, so it's tracked distinctly: surfaced in the
// log/history so a person reviewing recalibration history can tell "I did
// that on purpose" apart from a real detection, and excluded from chronic
// escalation for the same reason (see isChronicallyMisaligned's own
// comment).
export type VentMisalignmentTrigger = "auto" | "manual";

export interface VentMisalignmentState {
  windowSinceMs: number | null;
  windowStartTempC: number | null;
  recalibratingSinceMs: number | null;
  recalibrationTrigger: VentMisalignmentTrigger | null;
  // Which hardware extreme (0 or 100) this cycle is forcing the vent
  // toward — chosen once, when the cycle starts, as whichever extreme is
  // *farther* from the vent's own position at that moment: a vent already
  // near 80% is forced to 0, not nudged the remaining 20 points to 100 —
  // the point is a full-range, decisive movement that actually exercises
  // the vent's suspect direction, not a token further nudge the same way
  // it was already leaning. Fixed for the whole cycle (see
  // farthestExtremeFrom's own comment for why it can't be recomputed
  // live once the cycle is already forcing the vent toward it). Null
  // whenever recalibratingSinceMs is also null.
  targetExtremePct: 0 | 100 | null;
  lastRecalibratedAtMs: number | null;
}

export const EMPTY_VENT_MISALIGNMENT_STATE: VentMisalignmentState = {
  windowSinceMs: null,
  windowStartTempC: null,
  recalibratingSinceMs: null,
  recalibrationTrigger: null,
  targetExtremePct: null,
  lastRecalibratedAtMs: null,
};

export type VentMisalignmentAction =
  | { kind: "none" }
  | {
      kind: "force_open";
      triggeredBy: VentMisalignmentTrigger;
      targetPct: 0 | 100;
    }
  | {
      kind: "recalibration_finished";
      outcome: "opened" | "timed_out";
      triggeredBy: VentMisalignmentTrigger;
    };

// The one, hardware-truth extreme farther from `currentPositionPct` —
// deliberately ignores the zone's own configured min/max policy (the
// existing automatic cycle already forces literal 100 regardless of
// max_vent_position; this generalizes the same "diagnostic override
// exceeds normal position policy" precedent to both directions), since
// clearing physical motor stiction needs the vent's real full range, not
// whatever comfort-policy window it's normally kept within. A vent sitting
// exactly at the midpoint (50%) is treated as "closer to open" — an
// arbitrary but harmless tie-break, since either direction is an equally
// valid, equally decisive test from dead center.
function farthestExtremeFrom(currentPositionPct: number): 0 | 100 {
  return currentPositionPct >= 50 ? 0 : 100;
}

// Symmetric tolerance around whichever extreme this cycle is forcing
// toward — mirrors the existing >=90 threshold the original (open-only)
// design used, just generalized to the 0% side too.
function isNearExtreme(reportedPct: number, extremePct: 0 | 100): boolean {
  return extremePct === 100 ? reportedPct >= 90 : reportedPct <= 10;
}

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
 * Detection window: anchored the instant a zone is simultaneously (a) its
 * own *computed target* sitting at the zone's fully-closed extreme, (b)
 * classified `satisfied` — a genuinely `demanding` zone's own dispatch gap
 * is the separate, already-fixed sleep-mode-threshold problem, not this
 * one — and (c) the system is actively calling (COOLING_CALL/HEATING_CALL).
 * Reset the instant any of those three breaks: an idle-segment rebound is
 * normal for every zone, sealed or not, so only the temp response *within
 * one uninterrupted call segment* is diagnostic. Flags once the zone has
 * moved by `tempThresholdC` in the call's own direction since the window
 * opened (colder during COOLING_CALL, warmer during HEATING_CALL).
 *
 * Keyed off the *target*, not the vent's own *reported* position — a
 * real, confirmed incident: a vent settled at a reported 10% (physically
 * confirmed open closer to 30%) for 5+ hours while its target sat at 0%
 * the whole time, undetected, because the original design required the
 * vent to report exactly 0% before this even started tracking. The
 * target is what this app has already concluded is correct; whether the
 * vent is currently stuck reporting 0%, 10%, or anything else in between
 * doesn't change that a "should be closed, room keeps drifting anyway"
 * situation is just as real and just as worth auto-correcting.
 *
 * Correction: a full home cycle rather than a diagnosis-only alert — an
 * occasional deliberate open/close is cheaper than a vent silently stuck
 * open all night. `force_open` is returned every tick the cycle is still
 * waiting for the vent to actually report itself open; the caller is
 * responsible for actually commanding 100% while that's the action, and
 * for snapping straight back to the pipeline's own natural target the
 * instant `recalibration_finished` fires rather than letting the ordinary
 * ramp walk back down over several minutes — a real, confirmed cost: an
 * uncorrected ramp-down held the vent substantially open for ~10 more
 * minutes after every cycle, actively cooling an already-overcooled room
 * the whole time. `maxOpenWaitMs` bounds how long the open-wait can run —
 * a vent with a genuinely stuck/disconnected motor shouldn't hold its zone
 * open indefinitely — and either a real open or a timeout starts
 * `debounceMs`, a short settle period (not a long cooldown — see its own
 * comment in systemSettings.ts) before detection can re-open a window.
 *
 * `manualTriggerRequested` starts the exact same force-open/wait cycle on
 * demand — a deliberate maintenance action (verify a vent someone
 * physically inspected actually recloses cleanly), not the detector
 * itself noticing a problem — so it bypasses the debounce and the
 * tracking-window/temp-threshold conditions entirely; the only thing that
 * blocks it is a cycle already in progress (checked first, regardless of
 * origin).
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
  targetAtClosedExtreme: boolean;
  // The zone's own computed target this tick, before any force-open
  // override — what farthestExtremeFrom picks a direction relative to.
  // For the automatic path this is always ≈0 (targetAtClosedExtreme is
  // already a precondition below), so it always resolves to 100 there,
  // unchanged from the original open-only design; it only actually
  // matters for a manual trigger, which can start from anywhere.
  currentPositionPct: number;
  ventReportedPositionsPct: readonly number[];
  calibratedTempC: number | null;
  prior: VentMisalignmentState;
  tempThresholdC: number;
  debounceMs: number;
  maxOpenWaitMs: number;
  manualTriggerRequested: boolean;
}): VentMisalignmentEvaluation {
  const { prior } = params;

  if (prior.recalibratingSinceMs !== null) {
    const waitedMs = params.nowMs - prior.recalibratingSinceMs;
    const timedOut = waitedMs >= params.maxOpenWaitMs;
    const triggeredBy = prior.recalibrationTrigger ?? "auto";
    // A cycle already in progress from before this direction-aware fix
    // was deployed carries no targetExtremePct at all (an older,
    // open-only build never persisted one) — default it to 100 to match
    // that build's own hardcoded behavior, rather than losing track of
    // an in-flight cycle entirely.
    const targetExtremePct = prior.targetExtremePct ?? 100;
    const allAtExtreme = params.ventReportedPositionsPct.every((pct) =>
      isNearExtreme(pct, targetExtremePct),
    );
    if (allAtExtreme || timedOut) {
      return {
        next: {
          windowSinceMs: null,
          windowStartTempC: null,
          recalibratingSinceMs: null,
          recalibrationTrigger: null,
          targetExtremePct: null,
          lastRecalibratedAtMs: params.nowMs,
        },
        action: {
          kind: "recalibration_finished",
          outcome: allAtExtreme ? "opened" : "timed_out",
          triggeredBy,
        },
        suspected: false,
      };
    }
    return {
      next: prior,
      action: { kind: "force_open", triggeredBy, targetPct: targetExtremePct },
      suspected: true,
    };
  }

  if (params.manualTriggerRequested) {
    const targetExtremePct = farthestExtremeFrom(params.currentPositionPct);
    return {
      next: {
        windowSinceMs: null,
        windowStartTempC: null,
        recalibratingSinceMs: params.nowMs,
        recalibrationTrigger: "manual",
        targetExtremePct,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      },
      action: {
        kind: "force_open",
        triggeredBy: "manual",
        targetPct: targetExtremePct,
      },
      suspected: true,
    };
  }

  const inDebounce =
    prior.lastRecalibratedAtMs !== null &&
    params.nowMs - prior.lastRecalibratedAtMs < params.debounceMs;
  if (inDebounce) {
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
    params.targetAtClosedExtreme &&
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
        recalibrationTrigger: null,
        targetExtremePct: null,
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

  const targetExtremePct = farthestExtremeFrom(params.currentPositionPct);
  return {
    next: {
      windowSinceMs: prior.windowSinceMs,
      windowStartTempC: prior.windowStartTempC,
      recalibratingSinceMs: params.nowMs,
      recalibrationTrigger: "auto",
      targetExtremePct,
      lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
    },
    action: {
      kind: "force_open",
      triggeredBy: "auto",
      targetPct: targetExtremePct,
    },
    suspected: true,
  };
}

/**
 * Chronic escalation: every recorded recalibration outcome can read
 * "opened" (proof the motor moves when commanded, not proof it actually
 * seals afterward) and the same zone still needs another cycle a few
 * hours later — real, confirmed live across three zones on one air
 * handler over 2.5 days, each recalibrating roughly once every debounce
 * period, indefinitely. `thresholdCount` or more completed recalibrations
 * within `windowMs` is treated as strong evidence of a persistent physical
 * problem recalibration can't fix by cycling it, not a one-off. A derived
 * value, not its own persisted state — recomputed from
 * `recalibrationHistoryMs` every time, so the manual "clear warning"
 * action is nothing more than clearing that history; there's nothing else
 * to keep in sync. Manually-triggered cycles are deliberately excluded
 * from the history this counts against (see the caller, which only
 * records an `auto`-triggered completion) — a maintenance check someone
 * ran on purpose isn't evidence of anything by itself.
 */
export function isChronicallyMisaligned(params: {
  recalibrationHistoryMs: readonly number[];
  nowMs: number;
  windowMs: number;
  thresholdCount: number;
}): boolean {
  const cutoffMs = params.nowMs - params.windowMs;
  const recentCount = params.recalibrationHistoryMs.filter(
    (ms) => ms > cutoffMs,
  ).length;
  return recentCount >= params.thresholdCount;
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
