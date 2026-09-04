import { describe, it, expect } from "vitest";
import { formatDispatchStatus } from "~/client/util/formatDispatchStatus";

describe("formatDispatchStatus", () => {
  it("reports 'sent' once a command has actually gone out, regardless of the delta fields", () => {
    expect(
      formatDispatchStatus({
        dispatch_decision: "dispatched",
        step_delta_pct: null,
        min_step_delta_pct: null,
      }),
    ).toBe("sent");
  });

  it("reports the accumulated delta against the threshold while a command is held", () => {
    expect(
      formatDispatchStatus({
        dispatch_decision: "suppressed_step_delta",
        step_delta_pct: 12,
        min_step_delta_pct: 30,
      }),
    ).toBe("holding (Δ12%/30%)");
  });

  // Regression test: a vent already sitting exactly where this app last
  // asked it to be (target === last-dispatched, e.g. a satisfied zone
  // resting at its own 0% floor) has nothing pending — "holding (Δ0% of
  // 15% to move)" falsely implies a real, growing correction is being
  // deliberately delayed. Caught live via a screenshot of two satisfied,
  // fully-closed bedrooms both showing that exact misleading label.
  it("reports 'no change needed' rather than 'holding' when the accumulated delta is exactly zero", () => {
    expect(
      formatDispatchStatus({
        dispatch_decision: "suppressed_step_delta",
        step_delta_pct: 0,
        min_step_delta_pct: 15,
      }),
    ).toBe("no change needed");
  });

  it("returns null for a held command with no delta data (no dispatch decision was actually made this tick)", () => {
    expect(
      formatDispatchStatus({
        dispatch_decision: "suppressed_step_delta",
        step_delta_pct: null,
        min_step_delta_pct: null,
      }),
    ).toBeNull();
  });
});
