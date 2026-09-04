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
    ).toBe("holding (Δ12% of 30% to move)");
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
