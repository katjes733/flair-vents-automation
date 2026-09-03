import { describe, it, expect } from "vitest";
import { computeSetpointPush } from "~/server/domain/setpoint/setpointPush";

// trackedZoneTemp (24, 3°C over setpoint) and thermostatReading (23) are
// deliberately different numbers — Ecobee's own comparison point should
// never need to match the tracked zone's actual temperature for the
// mechanism to work, and using two distinct values here is what would
// have caught the real bug this offset formula once had: an earlier
// version computed the offset from trackedZoneSetpoint instead of
// trackedZoneTemp, which collapses pushedValue to ≈thermostatReading
// regardless of the tracked zone's real state (see computeSetpointPush's
// own comment). A fixture where temp === setpoint can't distinguish the
// two formulas at all.
const base = {
  state: "COOLING_CALL" as const,
  trackedZoneSetpoint: 21,
  trackedZoneTemp: 24,
  trackedZoneStale: false,
  thermostatReading: 23,
  previousSmoothedOffset: 0,
  alpha: 1, // no smoothing lag, for exact-property tests
  maxAbsOffsetC: 5,
  demandingZoneCount: 1,
  terminationMarginC: 0.3,
};

describe("computeSetpointPush — offset correction", () => {
  it("pushes trackedZoneSetpoint + smoothedOffset(thermostatReading - trackedZoneTemp) while demand remains", () => {
    const result = computeSetpointPush(base);
    expect(result.mechanism).toBe("offset_correction");
    expect(result.pushedValue).toBeCloseTo(21 + (23 - 24), 5);
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

  it("suppresses when the tracked zone's temperature is unavailable", () => {
    const result = computeSetpointPush({ ...base, trackedZoneTemp: null });
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
  // The real property (see the plan's "cross-system-type safety" test):
  // what Ecobee itself perceives — the gap between its own reading and
  // the pushed value — should never exceed the tracked zone's actual,
  // real gap from its own setpoint. With no smoothing lag this holds as
  // an exact identity regardless of what thermostatReading happens to be,
  // which is exactly the point: the mechanism translates the real zone's
  // urgency into Ecobee's frame correctly no matter what Ecobee's own
  // sensor reads.
  it("the pushed gap never exceeds the tracked zone's real gap (no smoothing lag)", () => {
    const result = computeSetpointPush(base);
    const realGap = Math.abs(base.trackedZoneTemp - base.trackedZoneSetpoint);
    const pushedGap = Math.abs(base.thermostatReading - result.pushedValue);
    expect(pushedGap).toBeCloseTo(realGap, 9);
  });

  // Only true up to the configured offset clamp — if Ecobee's own reading
  // disagrees with the tracked zone's real temperature by more than
  // maxAbsOffsetC, the clamp itself (a deliberate, separate sanity bound
  // on the pushed value, not this bug fix) can let the perceived gap
  // exceed the real one by at most that same clamp margin. Every reading
  // below stays within the ±5 clamp, so the identity holds exactly.
  it("holds regardless of what Ecobee's own thermostat reading happens to be, within the offset clamp", () => {
    const realGap = Math.abs(base.trackedZoneTemp - base.trackedZoneSetpoint);
    for (const thermostatReading of [20, 22, 24, 26, 28]) {
      const result = computeSetpointPush({ ...base, thermostatReading });
      const pushedGap = Math.abs(thermostatReading - result.pushedValue);
      expect(pushedGap).toBeCloseTo(realGap, 9);
    }
  });
});
