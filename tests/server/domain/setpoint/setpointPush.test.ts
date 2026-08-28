import { describe, it, expect } from "vitest";
import { computeSetpointPush } from "~/server/domain/setpoint/setpointPush";

const base = {
  state: "COOLING_CALL" as const,
  trackedZoneSetpoint: 21,
  trackedZoneStale: false,
  thermostatReading: 23,
  previousSmoothedOffset: 0,
  alpha: 1, // no smoothing lag, for exact-property tests
  maxAbsOffsetC: 5,
  demandingZoneCount: 1,
  terminationMarginC: 0.3,
};

describe("computeSetpointPush — offset correction", () => {
  it("pushes trackedZoneSetpoint + smoothedOffset while demand remains", () => {
    const result = computeSetpointPush(base);
    expect(result.mechanism).toBe("offset_correction");
    expect(result.pushedValue).toBeCloseTo(21 + (23 - 21), 5);
  });

  it("suppresses (raw setpoint, no offset) when the tracked zone is stale", () => {
    const result = computeSetpointPush({ ...base, trackedZoneStale: true });
    expect(result.mechanism).toBe("suppressed_tracked_zone_stale");
    expect(result.pushedValue).toBe(21);
  });

  it("suppresses when the thermostat reading is unavailable", () => {
    const result = computeSetpointPush({ ...base, thermostatReading: null });
    expect(result.mechanism).toBe("suppressed_tracked_zone_stale");
  });
});

describe("computeSetpointPush — termination", () => {
  it("fires only once every currently-demanding zone is satisfied", () => {
    const result = computeSetpointPush({ ...base, demandingZoneCount: 0 });
    expect(result.mechanism).toBe("termination_override");
  });

  it("never manufactures urgency — the cooling termination guard only moves the push warmer, never colder", () => {
    const withoutTermination = computeSetpointPush({
      ...base,
      demandingZoneCount: 1,
    });
    const withTermination = computeSetpointPush({
      ...base,
      demandingZoneCount: 0,
    });
    expect(withTermination.pushedValue).toBeGreaterThanOrEqual(
      withoutTermination.pushedValue,
    );
  });

  it("the heating termination guard only moves the push cooler, never hotter", () => {
    const heating = {
      ...base,
      state: "HEATING_CALL" as const,
      thermostatReading: 19,
    };
    const withoutTermination = computeSetpointPush({
      ...heating,
      demandingZoneCount: 1,
    });
    const withTermination = computeSetpointPush({
      ...heating,
      demandingZoneCount: 0,
    });
    expect(withTermination.pushedValue).toBeLessThanOrEqual(
      withoutTermination.pushedValue,
    );
  });
});

describe("computeSetpointPush — cross-system-type safety property", () => {
  it("the pushed gap never exceeds the tracked zone's real gap (no smoothing lag)", () => {
    const result = computeSetpointPush(base);
    const realGap = Math.abs(base.thermostatReading - base.trackedZoneSetpoint);
    const pushedGap = Math.abs(result.pushedValue - base.trackedZoneSetpoint);
    expect(pushedGap).toBeLessThanOrEqual(realGap + 1e-9);
  });
});
