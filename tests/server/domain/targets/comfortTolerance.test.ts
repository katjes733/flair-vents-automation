import { describe, it, expect } from "vitest";
import {
  resolveComfortTolerance,
  classifyZone,
  stabilizeClassification,
} from "~/server/domain/targets/comfortTolerance";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";

describe("resolveComfortTolerance", () => {
  it("prefers the schedule override over the zone default", () => {
    expect(resolveComfortTolerance(asTempDelta(1), asTempDelta(2))).toBe(2);
  });

  it("falls back to the zone default when no override applies", () => {
    expect(resolveComfortTolerance(asTempDelta(1), null)).toBe(1);
  });

  it("is null when neither is configured — unset, not zero", () => {
    expect(resolveComfortTolerance(null, null)).toBeNull();
  });
});

describe("classifyZone", () => {
  const setpoint = asAbsoluteTemp(21);

  it("is unclassified regardless of deviation when there's no temperature sensor", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: false,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(30),
        resolvedSetpoint: setpoint,
        tolerance: null,
        previousClassification: null,
      }),
    ).toBe("unclassified_no_sensor");
  });

  it("treats unset tolerance as tight targeting (0) — both edges collapse to the setpoint itself", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(21.1),
        resolvedSetpoint: setpoint,
        tolerance: null,
        previousClassification: "satisfied",
      }),
    ).toBe("demanding");
  });

  // Real thermostat cooling differential: tolerance=2 splits into a
  // symmetric ±1 band around the 21° setpoint (20-22), and which edge
  // governs depends on the *previous* classification, not a single static
  // boundary — this is the actual mechanism a real production comfort
  // complaint led to (a room's felt-average temperature running
  // systematically warmer than its own setpoint, because the old design's
  // "satisfied" band sat entirely above setpoint with no floor at all).
  describe("hysteresis — a symmetric band whose active edge depends on the previous state", () => {
    const tolerance = asTempDelta(2); // ±1°C around the 21° setpoint

    it("a demanding zone stays demanding all the way down to the lower edge (setpoint - tolerance/2)", () => {
      expect(
        classifyZone({
          hasTemperatureSensor: true,
          state: "COOLING_CALL",
          calibratedTemp: asAbsoluteTemp(20.1), // still just above the 20° lower edge
          resolvedSetpoint: setpoint,
          tolerance,
          previousClassification: "demanding",
        }),
      ).toBe("demanding");
    });

    it("a demanding zone becomes satisfied once it reaches the lower edge", () => {
      expect(
        classifyZone({
          hasTemperatureSensor: true,
          state: "COOLING_CALL",
          calibratedTemp: asAbsoluteTemp(20), // exactly at the lower edge
          resolvedSetpoint: setpoint,
          tolerance,
          previousClassification: "demanding",
        }),
      ).toBe("satisfied");
    });

    it("a satisfied zone stays satisfied all the way up to the upper edge (setpoint + tolerance/2)", () => {
      expect(
        classifyZone({
          hasTemperatureSensor: true,
          state: "COOLING_CALL",
          calibratedTemp: asAbsoluteTemp(22), // exactly at the upper edge
          resolvedSetpoint: setpoint,
          tolerance,
          previousClassification: "satisfied",
        }),
      ).toBe("satisfied");
    });

    it("a satisfied zone becomes demanding once it crosses past the upper edge", () => {
      expect(
        classifyZone({
          hasTemperatureSensor: true,
          state: "COOLING_CALL",
          calibratedTemp: asAbsoluteTemp(22.1),
          resolvedSetpoint: setpoint,
          tolerance,
          previousClassification: "satisfied",
        }),
      ).toBe("demanding");
    });

    // The whole point of real hysteresis: a reading sitting inside the
    // band doesn't tell you the classification on its own — you also need
    // to know which direction you were already going.
    it("the same mid-band reading classifies differently depending on the previous state", () => {
      const midBand = asAbsoluteTemp(21); // dead center — inside both edges
      expect(
        classifyZone({
          hasTemperatureSensor: true,
          state: "COOLING_CALL",
          calibratedTemp: midBand,
          resolvedSetpoint: setpoint,
          tolerance,
          previousClassification: "demanding",
        }),
      ).toBe("demanding");
      expect(
        classifyZone({
          hasTemperatureSensor: true,
          state: "COOLING_CALL",
          calibratedTemp: midBand,
          resolvedSetpoint: setpoint,
          tolerance,
          previousClassification: "satisfied",
        }),
      ).toBe("satisfied");
    });

    // A brand-new zone (never classified) or one recovering from a stale/
    // missing reading gets the same "no protected continuity to preserve
    // yet" treatment stabilizeClassification already gives these two cases
    // — treated as if it were previously satisfied (the upper edge), so it
    // doesn't demand until genuinely warm enough to warrant it.
    it("null previousClassification uses the upper edge, same as a satisfied zone", () => {
      expect(
        classifyZone({
          hasTemperatureSensor: true,
          state: "COOLING_CALL",
          calibratedTemp: asAbsoluteTemp(22),
          resolvedSetpoint: setpoint,
          tolerance,
          previousClassification: null,
        }),
      ).toBe("satisfied");
    });

    it("previousClassification of unclassified_no_sensor also uses the upper edge", () => {
      expect(
        classifyZone({
          hasTemperatureSensor: true,
          state: "COOLING_CALL",
          calibratedTemp: asAbsoluteTemp(22),
          resolvedSetpoint: setpoint,
          tolerance,
          previousClassification: "unclassified_no_sensor",
        }),
      ).toBe("satisfied");
    });
  });

  it("computes deviation in the correct direction for HEATING_CALL", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(19),
        resolvedSetpoint: setpoint,
        tolerance: null,
        previousClassification: "satisfied",
      }),
    ).toBe("demanding");
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(22),
        resolvedSetpoint: setpoint,
        tolerance: null,
        previousClassification: "demanding",
      }),
    ).toBe("satisfied");
  });
});

describe("stabilizeClassification", () => {
  const NOW = 1_000_000;

  it("adopts the raw value immediately when there's no previous classification (a brand-new zone)", () => {
    const result = stabilizeClassification({
      raw: "demanding",
      previousClassification: null,
      previousPending: null,
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    expect(result).toEqual({
      classification: "demanding",
      pendingClassification: null,
      pendingSinceMs: null,
    });
  });

  it("stays stable with no pending state when the raw value agrees with the previous classification", () => {
    const result = stabilizeClassification({
      raw: "satisfied",
      previousClassification: "satisfied",
      previousPending: { classification: "demanding", sinceMs: NOW - 1000 },
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    // A raw value matching the current classification clears any stale
    // pending flip in the opposite direction — there's nothing left to
    // debounce toward.
    expect(result).toEqual({
      classification: "satisfied",
      pendingClassification: null,
      pendingSinceMs: null,
    });
  });

  it("holds the previous classification and starts a dwell timer when the raw value first disagrees", () => {
    const result = stabilizeClassification({
      raw: "demanding",
      previousClassification: "satisfied",
      previousPending: null,
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    expect(result).toEqual({
      classification: "satisfied",
      pendingClassification: "demanding",
      pendingSinceMs: NOW,
    });
  });

  it("keeps the original dwell anchor while the same disagreeing value persists across ticks", () => {
    const startedAt = NOW - 2 * 60_000; // 2 minutes into a 5-minute dwell
    const result = stabilizeClassification({
      raw: "demanding",
      previousClassification: "satisfied",
      previousPending: { classification: "demanding", sinceMs: startedAt },
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    // Still held (2 minutes < 5-minute dwell) — sinceMs is unchanged, not
    // reset to `now`, since it's the same disagreeing value still pending.
    expect(result).toEqual({
      classification: "satisfied",
      pendingClassification: "demanding",
      pendingSinceMs: startedAt,
    });
  });

  it("flips to the raw value once the dwell has fully elapsed", () => {
    const startedAt = NOW - 5 * 60_000; // exactly 5 minutes ago
    const result = stabilizeClassification({
      raw: "demanding",
      previousClassification: "satisfied",
      previousPending: { classification: "demanding", sinceMs: startedAt },
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    expect(result).toEqual({
      classification: "demanding",
      pendingClassification: null,
      pendingSinceMs: null,
    });
  });

  it("resets the dwell timer if a different raw value briefly appears mid-dwell", () => {
    // Was dwelling toward "demanding" since 4 minutes ago (short of the
    // 5-minute bar); this tick's raw value is "unclassified_no_sensor"
    // instead — a genuinely different disagreement, so the dwell restarts
    // against the new value rather than inheriting the old timer.
    const oldPendingStart = NOW - 4 * 60_000;
    const result = stabilizeClassification({
      raw: "unclassified_no_sensor",
      previousClassification: "satisfied",
      previousPending: {
        classification: "demanding",
        sinceMs: oldPendingStart,
      },
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    expect(result).toEqual({
      classification: "satisfied",
      pendingClassification: "unclassified_no_sensor",
      pendingSinceMs: NOW,
    });
  });

  // Regression test for a real, confirmed bug: a zone recovering from a
  // stale/unavailable reading (classified "unclassified_no_sensor" on the
  // previous tick) was held in a dwell before its real classification was
  // reported, contradicting the Stale Sensor Reading Safeguard's own
  // "resumes immediately" contract — traced live via a real production
  // alert where a zone's sensor resumed reporting at one tick but the
  // zone wasn't treated as demanding again until 3 minutes (a full
  // stabilizationMinutes dwell) later.
  it("adopts the raw value immediately when recovering from unclassified_no_sensor, with no dwell", () => {
    const result = stabilizeClassification({
      raw: "demanding",
      previousClassification: "unclassified_no_sensor",
      previousPending: null,
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    expect(result).toEqual({
      classification: "demanding",
      pendingClassification: null,
      pendingSinceMs: null,
    });
  });

  it("adopts the raw value immediately when recovering to satisfied from unclassified_no_sensor, even with a stale pending flip in flight", () => {
    const result = stabilizeClassification({
      raw: "satisfied",
      previousClassification: "unclassified_no_sensor",
      previousPending: { classification: "demanding", sinceMs: NOW - 60_000 },
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    expect(result).toEqual({
      classification: "satisfied",
      pendingClassification: null,
      pendingSinceMs: null,
    });
  });
});
