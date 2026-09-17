import { describe, it, expect } from "vitest";
import {
  evaluateVentMisalignment,
  updateRecalibrationHistory,
  isChronicallyMisaligned,
  EMPTY_VENT_MISALIGNMENT_STATE,
  type VentMisalignmentState,
} from "~/server/domain/sensors/ventMisalignment";

const NOW = 1_000_000;
const THRESHOLD_C = 0.56;
const DEBOUNCE_MS = 3 * 60000;
const MAX_OPEN_WAIT_MS = 10 * 60000;

function base(
  overrides: Partial<Parameters<typeof evaluateVentMisalignment>[0]> = {},
) {
  return {
    nowMs: NOW,
    hvacState: "COOLING_CALL" as const,
    callActive: true,
    classification: "satisfied" as const,
    targetAtClosedExtreme: true,
    allVentsReportedOpenEnough: false,
    calibratedTempC: 21,
    prior: EMPTY_VENT_MISALIGNMENT_STATE,
    tempThresholdC: THRESHOLD_C,
    debounceMs: DEBOUNCE_MS,
    maxOpenWaitMs: MAX_OPEN_WAIT_MS,
    manualTriggerRequested: false,
    ...overrides,
  };
}

describe("evaluateVentMisalignment", () => {
  describe("window tracking", () => {
    it("starts a fresh window the first tick tracking conditions hold, taking no action", () => {
      const result = evaluateVentMisalignment(base());
      expect(result.next).toEqual({
        windowSinceMs: NOW,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: null,
      });
      expect(result.action).toEqual({ kind: "none" });
      expect(result.suspected).toBe(false);
    });

    it("does not start a window when there's no live reading yet", () => {
      const result = evaluateVentMisalignment(base({ calibratedTempC: null }));
      expect(result.next).toEqual(EMPTY_VENT_MISALIGNMENT_STATE);
      expect(result.action).toEqual({ kind: "none" });
    });

    it("resets the window when the target is no longer at the closed extreme", () => {
      const prior: VentMisalignmentState = {
        windowSinceMs: NOW - 600_000,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: null,
      };
      const result = evaluateVentMisalignment(
        base({ prior, targetAtClosedExtreme: false, calibratedTempC: 19 }),
      );
      expect(result.next).toEqual(EMPTY_VENT_MISALIGNMENT_STATE);
      expect(result.action).toEqual({ kind: "none" });
    });

    it("resets the window when the zone is no longer classified satisfied", () => {
      const prior: VentMisalignmentState = {
        windowSinceMs: NOW - 600_000,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: null,
      };
      const result = evaluateVentMisalignment(
        base({ prior, classification: "demanding" }),
      );
      expect(result.next).toEqual(EMPTY_VENT_MISALIGNMENT_STATE);
    });

    // Regression coverage: only response *within one uninterrupted call
    // segment* is diagnostic — a room warming back up while genuinely
    // idle is normal for every zone, sealed or not, so a window must not
    // survive an idle gap and get compared against temp from before it.
    it("resets the window the instant the call becomes inactive, not just when it resumes", () => {
      const prior: VentMisalignmentState = {
        windowSinceMs: NOW - 600_000,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: null,
      };
      const result = evaluateVentMisalignment(
        base({ prior, callActive: false, calibratedTempC: 19 }),
      );
      expect(result.next).toEqual(EMPTY_VENT_MISALIGNMENT_STATE);
      expect(result.action).toEqual({ kind: "none" });
    });

    it("does not flag while the temp hasn't drifted past the threshold yet", () => {
      const prior: VentMisalignmentState = {
        windowSinceMs: NOW - 600_000,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: null,
      };
      const result = evaluateVentMisalignment(
        base({ prior, calibratedTempC: 21 - THRESHOLD_C + 0.01 }),
      );
      expect(result.action).toEqual({ kind: "none" });
      expect(result.suspected).toBe(false);
      expect(result.next).toEqual(prior);
    });
  });

  describe("flagging — COOLING_CALL", () => {
    const prior: VentMisalignmentState = {
      windowSinceMs: NOW - 1_800_000,
      windowStartTempC: 21,
      recalibratingSinceMs: null,
      recalibrationTrigger: null,
      lastRecalibratedAtMs: null,
    };

    it("flags once the room has cooled by the full threshold since the window opened", () => {
      const result = evaluateVentMisalignment(
        base({ prior, calibratedTempC: 21 - THRESHOLD_C - 0.01 }),
      );
      expect(result.action).toEqual({
        kind: "force_open",
        triggeredBy: "auto",
      });
      expect(result.suspected).toBe(true);
      expect(result.next).toEqual({
        ...prior,
        recalibratingSinceMs: NOW,
        recalibrationTrigger: "auto",
      });
    });

    it("does not flag a room that warmed instead of cooled", () => {
      const result = evaluateVentMisalignment(
        base({ prior, calibratedTempC: 21 + 2 }),
      );
      expect(result.action).toEqual({ kind: "none" });
      expect(result.suspected).toBe(false);
    });
  });

  describe("flagging — HEATING_CALL", () => {
    const prior: VentMisalignmentState = {
      windowSinceMs: NOW - 1_800_000,
      windowStartTempC: 19,
      recalibratingSinceMs: null,
      recalibrationTrigger: null,
      lastRecalibratedAtMs: null,
    };

    it("flags once the room has warmed by the full threshold since the window opened", () => {
      const result = evaluateVentMisalignment(
        base({
          prior,
          hvacState: "HEATING_CALL",
          calibratedTempC: 19 + THRESHOLD_C + 0.01,
        }),
      );
      expect(result.action).toEqual({
        kind: "force_open",
        triggeredBy: "auto",
      });
      expect(result.suspected).toBe(true);
    });

    it("does not flag a room that cooled instead of warmed", () => {
      const result = evaluateVentMisalignment(
        base({ prior, hvacState: "HEATING_CALL", calibratedTempC: 19 - 2 }),
      );
      expect(result.action).toEqual({ kind: "none" });
    });
  });

  describe("mid-recalibration", () => {
    const recalibrating: VentMisalignmentState = {
      windowSinceMs: NOW - 1_800_000,
      windowStartTempC: 21,
      recalibratingSinceMs: NOW - 120_000,
      recalibrationTrigger: "auto",
      lastRecalibratedAtMs: null,
    };

    it("keeps forcing the vent open while still waiting and under the timeout", () => {
      const result = evaluateVentMisalignment(
        base({
          prior: recalibrating,
          allVentsReportedOpenEnough: false,
        }),
      );
      expect(result.action).toEqual({
        kind: "force_open",
        triggeredBy: "auto",
      });
      expect(result.suspected).toBe(true);
      expect(result.next).toEqual(recalibrating);
    });

    // An in-progress home cycle isn't tied to the call still being
    // active — once triggered, it should run to completion (open
    // confirmed, or timed out) regardless of whether the driving zone's
    // own call happens to end mid-cycle.
    it("keeps forcing the vent open mid-cycle even if the call becomes inactive", () => {
      const result = evaluateVentMisalignment(
        base({
          prior: recalibrating,
          callActive: false,
          allVentsReportedOpenEnough: false,
        }),
      );
      expect(result.action).toEqual({
        kind: "force_open",
        triggeredBy: "auto",
      });
      expect(result.next).toEqual(recalibrating);
    });

    // A pending manual request must never interrupt an already-running
    // cycle, regardless of trigger — the "already recalibrating" check
    // always takes priority.
    it("ignores a manual trigger request while a cycle is already in progress", () => {
      const result = evaluateVentMisalignment(
        base({
          prior: recalibrating,
          allVentsReportedOpenEnough: false,
          manualTriggerRequested: true,
        }),
      );
      expect(result.action).toEqual({
        kind: "force_open",
        triggeredBy: "auto",
      });
      expect(result.next).toEqual(recalibrating);
    });

    it("finishes as 'opened' once the vent actually reports itself open, clearing all state and starting the debounce — reporting whichever trigger started the cycle", () => {
      const result = evaluateVentMisalignment(
        base({
          prior: recalibrating,
          allVentsReportedOpenEnough: true,
        }),
      );
      expect(result.action).toEqual({
        kind: "recalibration_finished",
        outcome: "opened",
        triggeredBy: "auto",
      });
      expect(result.suspected).toBe(false);
      expect(result.next).toEqual({
        windowSinceMs: null,
        windowStartTempC: null,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: NOW,
      });
    });

    it("times out and finishes as 'timed_out' if the vent never reports itself open in time, still starting the debounce", () => {
      const stuckSinceStart: VentMisalignmentState = {
        ...recalibrating,
        recalibratingSinceMs: NOW - MAX_OPEN_WAIT_MS,
      };
      const result = evaluateVentMisalignment(
        base({ prior: stuckSinceStart, allVentsReportedOpenEnough: false }),
      );
      expect(result.action).toEqual({
        kind: "recalibration_finished",
        outcome: "timed_out",
        triggeredBy: "auto",
      });
      expect(result.next).toEqual({
        windowSinceMs: null,
        windowStartTempC: null,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: NOW,
      });
    });
  });

  describe("manual trigger", () => {
    it("starts a cycle immediately on request, bypassing the debounce and tracking-window conditions entirely", () => {
      // None of the ordinary tracking conditions hold (not satisfied, not
      // at the closed extreme, not even callActive) — a manual trigger
      // doesn't care, unlike the automatic path.
      const result = evaluateVentMisalignment(
        base({
          manualTriggerRequested: true,
          classification: "demanding",
          targetAtClosedExtreme: false,
          callActive: false,
        }),
      );
      expect(result.action).toEqual({
        kind: "force_open",
        triggeredBy: "manual",
      });
      expect(result.suspected).toBe(true);
      expect(result.next).toEqual({
        windowSinceMs: null,
        windowStartTempC: null,
        recalibratingSinceMs: NOW,
        recalibrationTrigger: "manual",
        lastRecalibratedAtMs: null,
      });
    });

    it("starts a cycle on request even while a debounce from a prior cycle would otherwise block detection", () => {
      const prior: VentMisalignmentState = {
        ...EMPTY_VENT_MISALIGNMENT_STATE,
        lastRecalibratedAtMs: NOW - 60_000, // 1 minute ago, well under the debounce
      };
      const result = evaluateVentMisalignment(
        base({ prior, manualTriggerRequested: true }),
      );
      expect(result.action).toEqual({
        kind: "force_open",
        triggeredBy: "manual",
      });
    });
  });

  describe("debounce", () => {
    it("takes no action and clears any window while a recent recalibration is still within the debounce", () => {
      const prior: VentMisalignmentState = {
        windowSinceMs: NOW - 600_000,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: NOW - 60_000, // 1 minute ago, under the 3-min debounce
      };
      const result = evaluateVentMisalignment(
        base({ prior, calibratedTempC: 19 }), // would otherwise flag
      );
      expect(result.action).toEqual({ kind: "none" });
      expect(result.next).toEqual({
        ...EMPTY_VENT_MISALIGNMENT_STATE,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      });
    });

    it("resumes tracking once the debounce has fully elapsed", () => {
      const prior: VentMisalignmentState = {
        windowSinceMs: null,
        windowStartTempC: null,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: NOW - DEBOUNCE_MS,
      };
      const result = evaluateVentMisalignment(base({ prior }));
      expect(result.next).toEqual({
        windowSinceMs: NOW,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        recalibrationTrigger: null,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      });
    });
  });
});

describe("updateRecalibrationHistory", () => {
  const DAY_MS = 24 * 3600000;

  it("is a no-op on an empty history when nothing just completed", () => {
    expect(
      updateRecalibrationHistory({
        priorHistoryMs: [],
        nowMs: NOW,
        windowMs: DAY_MS,
        justCompletedMs: null,
      }),
    ).toEqual([]);
  });

  it("appends a just-completed event", () => {
    expect(
      updateRecalibrationHistory({
        priorHistoryMs: [NOW - 3600000],
        nowMs: NOW,
        windowMs: DAY_MS,
        justCompletedMs: NOW,
      }),
    ).toEqual([NOW - 3600000, NOW]);
  });

  it("prunes entries older than the window, keeping ones still inside it", () => {
    const justInside = NOW - DAY_MS + 1;
    const justOutside = NOW - DAY_MS - 1;
    expect(
      updateRecalibrationHistory({
        priorHistoryMs: [justOutside, justInside],
        nowMs: NOW,
        windowMs: DAY_MS,
        justCompletedMs: null,
      }),
    ).toEqual([justInside]);
  });

  it("prunes and appends in the same call", () => {
    const justOutside = NOW - DAY_MS - 1;
    const stillInside = NOW - 3600000;
    expect(
      updateRecalibrationHistory({
        priorHistoryMs: [justOutside, stillInside],
        nowMs: NOW,
        windowMs: DAY_MS,
        justCompletedMs: NOW,
      }),
    ).toEqual([stillInside, NOW]);
  });
});

describe("isChronicallyMisaligned", () => {
  const WINDOW_MS = 2 * 3600000;
  const THRESHOLD_COUNT = 3;

  it("is false when fewer than the threshold count fall within the window", () => {
    expect(
      isChronicallyMisaligned({
        recalibrationHistoryMs: [NOW - 3600000, NOW - 1_800_000],
        nowMs: NOW,
        windowMs: WINDOW_MS,
        thresholdCount: THRESHOLD_COUNT,
      }),
    ).toBe(false);
  });

  it("is true once the threshold count falls within the window", () => {
    expect(
      isChronicallyMisaligned({
        recalibrationHistoryMs: [NOW - 3600000, NOW - 1_800_000, NOW - 600_000],
        nowMs: NOW,
        windowMs: WINDOW_MS,
        thresholdCount: THRESHOLD_COUNT,
      }),
    ).toBe(true);
  });

  it("does not count entries outside the window even if the raw history is longer", () => {
    // Three total entries, but only two fall inside the 2h window — the
    // third is 3h old, spread out rather than clustered.
    expect(
      isChronicallyMisaligned({
        recalibrationHistoryMs: [
          NOW - 3 * 3600000,
          NOW - 1_800_000,
          NOW - 600_000,
        ],
        nowMs: NOW,
        windowMs: WINDOW_MS,
        thresholdCount: THRESHOLD_COUNT,
      }),
    ).toBe(false);
  });

  it("is false on an empty history", () => {
    expect(
      isChronicallyMisaligned({
        recalibrationHistoryMs: [],
        nowMs: NOW,
        windowMs: WINDOW_MS,
        thresholdCount: THRESHOLD_COUNT,
      }),
    ).toBe(false);
  });
});
