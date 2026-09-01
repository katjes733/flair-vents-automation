import { describe, it, expect } from "vitest";
import {
  cacheTickDecision,
  getCachedTickDecision,
  type AirHandlerTickDecision,
} from "~/server/control/tickDecision";

function decision(
  overrides: Partial<AirHandlerTickDecision> = {},
): AirHandlerTickDecision {
  return {
    air_handler_id: "ah-1",
    tick_at: "2024-01-01T00:00:00.000Z",
    duration_ms: 10,
    dry_run: false,
    control_disarmed: false,
    hvac_state: "IDLE",
    call_confidence: "reported",
    zones: [],
    contention: null,
    pressure: null,
    driving_zone: null,
    setpoint_push: null,
    narrative: "nothing happening",
    ...overrides,
  };
}

describe("tick decision cache", () => {
  it("returns null for an air handler that hasn't ticked yet", () => {
    expect(getCachedTickDecision("never-ticked")).toBeNull();
  });

  it("caches and overwrites per air handler, one entry each", () => {
    cacheTickDecision(decision({ air_handler_id: "ah-x", narrative: "first" }));
    cacheTickDecision(
      decision({ air_handler_id: "ah-x", narrative: "second" }),
    );
    expect(getCachedTickDecision("ah-x")?.narrative).toBe("second");
  });
});
