import type { HvacCallState, ZoneClassification } from "~/server/domain/types";

export interface DemandStallState {
  windowSinceMs: number | null;
  windowStartTempC: number | null;
  recalibratingSinceMs: number | null;
  lastRecalibratedAtMs: number | null;
  // Independent of the four fields above, and NOT gated by
  // lastRecalibratedAtMs/cooldownMs the way a fresh force-open attempt
  // is — see the module doc comment for why the mitigation and the
  // "try another fix" cooldown are deliberately separate concerns here.
  stalledSinceMs: number | null;
}

export const EMPTY_DEMAND_STALL_STATE: DemandStallState = {
  windowSinceMs: null,
  windowStartTempC: null,
  recalibratingSinceMs: null,
  lastRecalibratedAtMs: null,
  stalledSinceMs: null,
};

export type DemandStallAction =
  | { kind: "none" }
  | { kind: "force_open" }
  | { kind: "recalibration_finished"; outcome: "opened" | "timed_out" };

export interface DemandStallEvaluation {
  next: DemandStallState;
  action: DemandStallAction;
  // True for the whole stretch a zone should be excluded from
  // driving-zone eligibility (isEligible(), drivingZone.ts) — from the
  // tick a detection window first elapses with no improvement through
  // whichever later tick shows real progress. Independent of `action`:
  // stays true across an in-progress or just-abandoned force-open
  // attempt, since a best-effort fix attempt failing to help yet doesn't
  // mean the zone should start counting toward keeping the call running
  // again.
  stalled: boolean;
}

/**
 * Demand stall detection — see demand_stall_detection_enabled's own
 * comment (systemSettings.ts) for the real, confirmed live problem this
 * exists for: a *demanding* zone whose vent Flair confirms reaching a
 * real, meaningfully-open commanded position, but whose room temperature
 * shows no genuine improvement anyway — the mirror-image failure to
 * vent misalignment (evaluateVentMisalignment), which instead catches a
 * *satisfied* zone whose vent won't actually stay closed. Left
 * undetected, the air handler keeps calling indefinitely for a zone that
 * can never actually benefit, wasting real energy on every sibling zone
 * sharing the same call.
 *
 * Detection window: anchored the instant a zone is simultaneously
 * classified `demanding` and the system is actively calling
 * (COOLING_CALL/HEATING_CALL) — reset the instant either breaks, same
 * shape as vent misalignment's own window. Unlike vent misalignment,
 * there's no gate on where the *target* sits: even a small,
 * meaningfully-open commanded position should produce some real
 * improvement if the vent is actually working, so this doesn't wait for
 * the zone to be commanded near its ceiling the way
 * zone_no_improvement_alert_minutes's own (much slower, alert-only) check
 * does. Flags "stalled" once a full `detectionMs` window elapses without
 * the zone moving by `tempThresholdC` in the call's own direction.
 *
 * Mitigation is two-tier and deliberately decoupled: `stalled` flips
 * true immediately once a window fails, independent of whether a
 * force-open attempt is also warranted — the caller should treat this as
 * an immediate signal to stop counting the zone toward keeping the call
 * running, not wait on a fix attempt to also fail first. A best-effort
 * force-open home cycle (identical shape to vent misalignment's own —
 * command 100%, wait up to `maxOpenWaitMs` for real confirmation) runs in
 * parallel as a cheap attempt at an actual fix, gated by its own
 * `cooldownMs` so a persistently-faulty vent isn't cycled open every
 * tick. `stalled` clears itself the moment a later window shows genuine
 * improvement, whether or not a force-open attempt ever succeeded —
 * self-healing, no manual reset needed.
 */
export function evaluateDemandStall(params: {
  nowMs: number;
  hvacState: HvacCallState;
  callActive: boolean;
  classification: ZoneClassification | "inactive";
  calibratedTempC: number | null;
  prior: DemandStallState;
  tempThresholdC: number;
  detectionMs: number;
  cooldownMs: number;
  maxOpenWaitMs: number;
  allVentsReportedOpenEnough: boolean;
}): DemandStallEvaluation {
  const { prior } = params;

  // An in-progress force-open cycle must run to completion regardless of
  // whether tracking conditions still hold this tick — checked first,
  // before trackingActive below, mirroring evaluateVentMisalignment's own
  // ordering. This matters more here than there: forcing the vent open
  // is exactly what's expected to make the room start improving, which
  // can flip classification away from "demanding" mid-cycle — checking
  // trackingActive first would abandon the cycle the instant it started
  // working, silently dropping stalledSinceMs/lastRecalibratedAtMs with
  // it (see the !trackingActive branch below).
  if (prior.recalibratingSinceMs !== null) {
    const waitedMs = params.nowMs - prior.recalibratingSinceMs;
    const timedOut = waitedMs >= params.maxOpenWaitMs;
    if (params.allVentsReportedOpenEnough || timedOut) {
      // A timeout is a strong signal the vent won't even confirm
      // reaching open — treat as stalled immediately rather than waiting
      // for a whole additional detection window to say so again.
      const stalledSinceMs = timedOut
        ? (prior.stalledSinceMs ?? params.nowMs)
        : prior.stalledSinceMs;
      return {
        next: {
          windowSinceMs: null,
          windowStartTempC: null,
          recalibratingSinceMs: null,
          lastRecalibratedAtMs: params.nowMs,
          stalledSinceMs,
        },
        action: {
          kind: "recalibration_finished",
          outcome: timedOut ? "timed_out" : "opened",
        },
        stalled: stalledSinceMs !== null,
      };
    }
    return {
      next: prior,
      action: { kind: "force_open" },
      stalled: prior.stalledSinceMs !== null,
    };
  }

  const trackingActive =
    params.callActive && params.classification === "demanding";
  if (!trackingActive) {
    // Preserves lastRecalibratedAtMs through the reset — a real,
    // confirmed live bug: this zone's own ordinary demanding/satisfied
    // cycling flips trackingActive false roughly every 15-20 minutes,
    // and returning the raw EMPTY_DEMAND_STALL_STATE here (which zeroes
    // lastRecalibratedAtMs too) erased cooldownMs's own gating almost
    // immediately after every single completed cycle — a configured
    // 4-hour cooldown was never actually in effect, since the very next
    // idle/satisfied gap wiped it before it could block anything. See
    // evaluateVentMisalignment's own equivalent reset for the same fix
    // already in place there. stalledSinceMs is NOT preserved — a zone
    // that's no longer demanding at all isn't a driving-zone eligibility
    // candidate anyway, so letting `stalled` clear here is harmless and
    // matches the original design intent (reset the instant tracking
    // breaks, same shape as vent misalignment's own window).
    return {
      next: {
        ...EMPTY_DEMAND_STALL_STATE,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      },
      action: { kind: "none" },
      stalled: false,
    };
  }

  if (prior.windowSinceMs === null || prior.windowStartTempC === null) {
    if (params.calibratedTempC === null) {
      return {
        next: prior,
        action: { kind: "none" },
        stalled: prior.stalledSinceMs !== null,
      };
    }
    return {
      next: {
        windowSinceMs: params.nowMs,
        windowStartTempC: params.calibratedTempC,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
        stalledSinceMs: prior.stalledSinceMs,
      },
      action: { kind: "none" },
      stalled: prior.stalledSinceMs !== null,
    };
  }

  if (params.calibratedTempC === null) {
    return {
      next: prior,
      action: { kind: "none" },
      stalled: prior.stalledSinceMs !== null,
    };
  }

  const elapsedMs = params.nowMs - prior.windowSinceMs;
  if (elapsedMs < params.detectionMs) {
    return {
      next: prior,
      action: { kind: "none" },
      stalled: prior.stalledSinceMs !== null,
    };
  }

  const deltaC = params.calibratedTempC - prior.windowStartTempC;
  const improved =
    params.hvacState === "COOLING_CALL"
      ? deltaC <= -params.tempThresholdC
      : deltaC >= params.tempThresholdC;

  if (improved) {
    return {
      next: {
        windowSinceMs: params.nowMs,
        windowStartTempC: params.calibratedTempC,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
        stalledSinceMs: null,
      },
      action: { kind: "none" },
      stalled: false,
    };
  }

  const stalledSinceMs = prior.stalledSinceMs ?? params.nowMs;
  const inCooldown =
    prior.lastRecalibratedAtMs !== null &&
    params.nowMs - prior.lastRecalibratedAtMs < params.cooldownMs;

  if (inCooldown) {
    return {
      next: {
        windowSinceMs: params.nowMs,
        windowStartTempC: params.calibratedTempC,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
        stalledSinceMs,
      },
      action: { kind: "none" },
      stalled: true,
    };
  }

  return {
    next: {
      windowSinceMs: params.nowMs,
      windowStartTempC: params.calibratedTempC,
      recalibratingSinceMs: params.nowMs,
      lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      stalledSinceMs,
    },
    action: { kind: "force_open" },
    stalled: true,
  };
}
