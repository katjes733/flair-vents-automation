import { describe, it, expect } from "vitest";
import {
  evaluateDemandStall,
  EMPTY_DEMAND_STALL_STATE,
  type DemandStallState,
} from "~/server/domain/sensors/demandStall";

const NOW = 1_000_000;
const THRESHOLD_C = 0.56;
const DETECTION_MS = 12 * 60000;
const COOLDOWN_MS = 4 * 3600000;
const MAX_OPEN_WAIT_MS = 10 * 60000;

function base(
  overrides: Partial<Parameters<typeof evaluateDemandStall>[0]> = {},
) {
  return {
    nowMs: NOW,
    hvacState: "COOLING_CALL" as const,
    callActive: true,
    classification: "demanding" as const,
    allVentsReportedOpenEnough: false,
    calibratedTempC: 21,
    prior: EMPTY_DEMAND_STALL_STATE,
    tempThresholdC: THRESHOLD_C,
    detectionMs: DETECTION_MS,
    cooldownMs: COOLDOWN_MS,
    maxOpenWaitMs: MAX_OPEN_WAIT_MS,
    ...overrides,
  };
}

describe("evaluateDemandStall", () => {
  describe("window tracking", () => {
    it("starts a fresh window the first tick tracking conditions hold, taking no action and not stalled", () => {
      const result = evaluateDemandStall(base());
      expect(result.next).toEqual({
        windowSinceMs: NOW,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: null,
        stalledSinceMs: null,
      });
      expect(result.action).toEqual({ kind: "none" });
      expect(result.stalled).toBe(false);
    });

    it("does not start a window when there's no live reading yet", () => {
      const result = evaluateDemandStall(base({ calibratedTempC: null }));
      expect(result.next).toEqual(EMPTY_DEMAND_STALL_STATE);
      expect(result.action).toEqual({ kind: "none" });
    });

    it("resets everything, including a prior stalled flag, when the zone is no longer classified demanding", () => {
      const prior: DemandStallState = {
        windowSinceMs: NOW - 900_000,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: null,
        stalledSinceMs: NOW - 300_000,
      };
      const result = evaluateDemandStall(
        base({ prior, classification: "satisfied" }),
      );
      expect(result.next).toEqual(EMPTY_DEMAND_STALL_STATE);
      expect(result.stalled).toBe(false);
    });

    it("resets the window the instant the call becomes inactive", () => {
      const prior: DemandStallState = {
        windowSinceMs: NOW - 900_000,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: null,
        stalledSinceMs: null,
      };
      const result = evaluateDemandStall(base({ prior, callActive: false }));
      expect(result.next).toEqual(EMPTY_DEMAND_STALL_STATE);
    });

    // Regression test for a real, confirmed live bug: this zone's own
    // ordinary demanding/satisfied cycling flips trackingActive false
    // roughly every 15-20 minutes, and the reset used to wipe
    // lastRecalibratedAtMs too (via the raw EMPTY_DEMAND_STALL_STATE) —
    // erasing cooldownMs's own gating almost immediately after every
    // completed cycle, so a configured multi-hour cooldown was never
    // actually in effect. stalledSinceMs is still cleared, deliberately —
    // a zone no longer demanding at all isn't a driving-zone eligibility
    // candidate anyway.
    it("preserves lastRecalibratedAtMs (the cooldown gate) through the reset, unlike stalledSinceMs", () => {
      const prior: DemandStallState = {
        windowSinceMs: NOW - 900_000,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: NOW - 60_000,
        stalledSinceMs: NOW - 300_000,
      };
      const result = evaluateDemandStall(
        base({ prior, classification: "satisfied" }),
      );
      expect(result.next).toEqual({
        ...EMPTY_DEMAND_STALL_STATE,
        lastRecalibratedAtMs: prior.lastRecalibratedAtMs,
      });
      expect(result.stalled).toBe(false);
    });

    // End-to-end sequence proving the cooldown fix actually holds across
    // a realistic idle gap, not just within one call: a cycle finishes,
    // the zone briefly goes idle (preserving the cooldown per the test
    // above), then re-enters demanding and immediately fails its very
    // first detection window again — this must be blocked by the
    // still-live cooldown, not treated as a fresh, ungated stall.
    it("still gates a fresh force-open by the cooldown across an intervening idle gap", () => {
      const justFinished: DemandStallState = {
        windowSinceMs: null,
        windowStartTempC: null,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: NOW,
        stalledSinceMs: NOW,
      };
      const idleGap = evaluateDemandStall(
        base({
          prior: justFinished,
          nowMs: NOW + 60_000,
          callActive: false,
        }),
      );
      expect(idleGap.next.lastRecalibratedAtMs).toBe(NOW);

      const reopenedWindow = evaluateDemandStall(
        base({ prior: idleGap.next, nowMs: NOW + 120_000 }),
      );
      const failsAgain = evaluateDemandStall(
        base({
          prior: reopenedWindow.next,
          nowMs: NOW + 120_000 + DETECTION_MS,
          calibratedTempC: 21, // no improvement
        }),
      );
      expect(failsAgain.action).toEqual({ kind: "none" });
      expect(failsAgain.stalled).toBe(true);
    });

    it("takes no action before the detection window has elapsed, even with zero improvement", () => {
      const prior: DemandStallState = {
        windowSinceMs: NOW - (DETECTION_MS - 1),
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: null,
        stalledSinceMs: null,
      };
      const result = evaluateDemandStall(
        base({ prior, calibratedTempC: 21 }), // no movement at all
      );
      expect(result.action).toEqual({ kind: "none" });
      expect(result.stalled).toBe(false);
      expect(result.next).toEqual(prior);
    });
  });

  describe("stalling — COOLING_CALL", () => {
    const prior: DemandStallState = {
      windowSinceMs: NOW - DETECTION_MS,
      windowStartTempC: 21,
      recalibratingSinceMs: null,
      lastRecalibratedAtMs: null,
      stalledSinceMs: null,
    };

    it("marks stalled and fires a best-effort force-open once the detection window elapses with no improvement", () => {
      const result = evaluateDemandStall(
        base({ prior, calibratedTempC: 21 }), // unchanged for the whole window
      );
      expect(result.stalled).toBe(true);
      expect(result.action).toEqual({ kind: "force_open" });
      expect(result.next).toMatchObject({
        recalibratingSinceMs: NOW,
        stalledSinceMs: NOW,
      });
    });

    it("does not stall a room that genuinely cooled by the full threshold", () => {
      const result = evaluateDemandStall(
        base({ prior, calibratedTempC: 21 - THRESHOLD_C - 0.01 }),
      );
      expect(result.action).toEqual({ kind: "none" });
      expect(result.stalled).toBe(false);
      expect(result.next).toMatchObject({
        windowSinceMs: NOW,
        windowStartTempC: 21 - THRESHOLD_C - 0.01,
        stalledSinceMs: null,
      });
    });

    it("stalls a room that warmed further instead of cooling", () => {
      const result = evaluateDemandStall(
        base({ prior, calibratedTempC: 21 + 1 }),
      );
      expect(result.stalled).toBe(true);
    });
  });

  describe("stalling — HEATING_CALL", () => {
    const prior: DemandStallState = {
      windowSinceMs: NOW - DETECTION_MS,
      windowStartTempC: 19,
      recalibratingSinceMs: null,
      lastRecalibratedAtMs: null,
      stalledSinceMs: null,
    };

    it("does not stall a room that genuinely warmed by the full threshold", () => {
      const result = evaluateDemandStall(
        base({
          prior,
          hvacState: "HEATING_CALL",
          calibratedTempC: 19 + THRESHOLD_C + 0.01,
        }),
      );
      expect(result.stalled).toBe(false);
    });

    it("stalls a room that cooled instead of warming", () => {
      const result = evaluateDemandStall(
        base({ prior, hvacState: "HEATING_CALL", calibratedTempC: 19 - 1 }),
      );
      expect(result.stalled).toBe(true);
    });
  });

  describe("mid-recalibration", () => {
    const recalibrating: DemandStallState = {
      windowSinceMs: NOW - DETECTION_MS,
      windowStartTempC: 21,
      recalibratingSinceMs: NOW - 120_000,
      lastRecalibratedAtMs: null,
      stalledSinceMs: NOW - 120_000,
    };

    it("keeps forcing the vent open while still waiting and under the timeout", () => {
      const result = evaluateDemandStall(
        base({ prior: recalibrating, allVentsReportedOpenEnough: false }),
      );
      expect(result.action).toEqual({ kind: "force_open" });
      expect(result.stalled).toBe(true);
      expect(result.next).toEqual(recalibrating);
    });

    // Regression test for a real, confirmed live bug: forcing the vent
    // open is exactly what's expected to make the room start improving,
    // which can flip classification away from "demanding" (or end the
    // call) mid-cycle — trackingActive used to be checked BEFORE this
    // in-progress-cycle check, so the cycle got silently abandoned (and
    // stalledSinceMs/lastRecalibratedAtMs wiped) the instant it started
    // working. Mirrors evaluateVentMisalignment's own ordering/guarantee.
    it("keeps forcing the vent open mid-cycle even if classification changes away from demanding", () => {
      const result = evaluateDemandStall(
        base({
          prior: recalibrating,
          classification: "satisfied",
          allVentsReportedOpenEnough: false,
        }),
      );
      expect(result.action).toEqual({ kind: "force_open" });
      expect(result.stalled).toBe(true);
      expect(result.next).toEqual(recalibrating);
    });

    it("keeps forcing the vent open mid-cycle even if the call becomes inactive", () => {
      const result = evaluateDemandStall(
        base({
          prior: recalibrating,
          callActive: false,
          allVentsReportedOpenEnough: false,
        }),
      );
      expect(result.action).toEqual({ kind: "force_open" });
      expect(result.stalled).toBe(true);
      expect(result.next).toEqual(recalibrating);
    });

    it("finishes as 'opened' once confirmed, starting the cooldown but NOT yet clearing stalled — a fresh window has to prove it actually helped first", () => {
      const result = evaluateDemandStall(
        base({ prior: recalibrating, allVentsReportedOpenEnough: true }),
      );
      expect(result.action).toEqual({
        kind: "recalibration_finished",
        outcome: "opened",
      });
      expect(result.stalled).toBe(true);
      expect(result.next).toEqual({
        windowSinceMs: null,
        windowStartTempC: null,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: NOW,
        stalledSinceMs: recalibrating.stalledSinceMs,
      });
    });

    it("times out and finishes as 'timed_out', still marked stalled", () => {
      const stuckSinceStart: DemandStallState = {
        ...recalibrating,
        recalibratingSinceMs: NOW - MAX_OPEN_WAIT_MS,
      };
      const result = evaluateDemandStall(
        base({ prior: stuckSinceStart, allVentsReportedOpenEnough: false }),
      );
      expect(result.action).toEqual({
        kind: "recalibration_finished",
        outcome: "timed_out",
      });
      expect(result.stalled).toBe(true);
    });
  });

  describe("cooldown — deliberately does not gate the stalled mitigation itself", () => {
    it("stays stalled and skips a fresh force-open attempt while a recent one is on cooldown", () => {
      const prior: DemandStallState = {
        windowSinceMs: NOW - DETECTION_MS,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: NOW - 60_000, // 1 minute ago, well under 4h
        stalledSinceMs: NOW - 3_600_000,
      };
      const result = evaluateDemandStall(
        base({ prior, calibratedTempC: 21 }), // still no improvement
      );
      expect(result.action).toEqual({ kind: "none" });
      expect(result.stalled).toBe(true);
      expect(result.next.stalledSinceMs).toBe(prior.stalledSinceMs);
    });

    it("still self-heals from a cooldown-blocked stall the moment real improvement shows up", () => {
      const prior: DemandStallState = {
        windowSinceMs: NOW - DETECTION_MS,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: NOW - 60_000,
        stalledSinceMs: NOW - 3_600_000,
      };
      const result = evaluateDemandStall(
        base({ prior, calibratedTempC: 21 - THRESHOLD_C - 0.01 }),
      );
      expect(result.stalled).toBe(false);
      expect(result.next.stalledSinceMs).toBeNull();
    });

    it("attempts a fresh force-open once the cooldown has fully elapsed", () => {
      const prior: DemandStallState = {
        windowSinceMs: NOW - DETECTION_MS,
        windowStartTempC: 21,
        recalibratingSinceMs: null,
        lastRecalibratedAtMs: NOW - COOLDOWN_MS,
        stalledSinceMs: NOW - 3_600_000,
      };
      const result = evaluateDemandStall(base({ prior, calibratedTempC: 21 }));
      expect(result.action).toEqual({ kind: "force_open" });
      expect(result.stalled).toBe(true);
    });
  });
});
