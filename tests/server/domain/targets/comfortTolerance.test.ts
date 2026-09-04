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
      }),
    ).toBe("unclassified_no_sensor");
  });

  it("treats unset tolerance as tight targeting (0)", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(21.1),
        resolvedSetpoint: setpoint,
        tolerance: null,
      }),
    ).toBe("demanding");
  });

  it("is satisfied exactly at the tolerance boundary, demanding just past it", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(22),
        resolvedSetpoint: setpoint,
        tolerance: asTempDelta(1),
      }),
    ).toBe("satisfied");
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "COOLING_CALL",
        calibratedTemp: asAbsoluteTemp(22.1),
        resolvedSetpoint: setpoint,
        tolerance: asTempDelta(1),
      }),
    ).toBe("demanding");
  });

  it("computes deviation in the correct direction for HEATING_CALL", () => {
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(19),
        resolvedSetpoint: setpoint,
        tolerance: null,
      }),
    ).toBe("demanding");
    expect(
      classifyZone({
        hasTemperatureSensor: true,
        state: "HEATING_CALL",
        calibratedTemp: asAbsoluteTemp(22),
        resolvedSetpoint: setpoint,
        tolerance: null,
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
});
