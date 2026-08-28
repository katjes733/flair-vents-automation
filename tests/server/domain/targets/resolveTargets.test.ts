import { describe, it, expect } from "vitest";
import { resolveZoneTargets } from "~/server/domain/targets/resolveTargets";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";

const NOW = Date.UTC(2024, 0, 1, 12, 0);
const NO_AWAY = {
  ecobeeAwayZoneIds: new Set<string>(),
  nativeAwayZoneIds: new Set<string>(),
};
const AWAY_TARGETS = {
  setpoint: asAbsoluteTemp(27.78),
  tolerance: asTempDelta(2.78),
};
const FALLBACK = { setpoint: asAbsoluteTemp(23.89), tolerance: null };

function base() {
  return {
    zoneId: "z1",
    nowMs: NOW,
    manualOverride: null,
    awaySource: NO_AWAY,
    awayTargets: AWAY_TARGETS,
    governingEvent: null,
    defaultInactive: false,
    fallback: FALLBACK,
    zoneTolerance: null,
    state: "COOLING_CALL" as const,
  };
}

describe("resolveZoneTargets", () => {
  it("a setpoint manual override wins over everything else", () => {
    const result = resolveZoneTargets({
      ...base(),
      manualOverride: {
        config: {
          kind: "setpoint",
          value: 20,
          hold_type: "permanent",
          actor: "Martin",
        },
        expiresAtMs: null,
        revokedAtMs: null,
      },
      awaySource: {
        ecobeeAwayZoneIds: new Set(["z1"]),
        nativeAwayZoneIds: new Set(),
      },
    });
    expect(result).toEqual({
      setpoint: 20,
      tolerance: null,
      source: "manual",
      manualPositionPct: null,
    });
  });

  it("a position manual override still resolves a real setpoint beneath it", () => {
    const result = resolveZoneTargets({
      ...base(),
      manualOverride: {
        config: {
          kind: "position",
          value: 75,
          hold_type: "permanent",
          actor: "Martin",
        },
        expiresAtMs: null,
        revokedAtMs: null,
      },
    });
    expect(result.source).toBe("manual");
    expect(result.manualPositionPct).toBe(75);
    expect(result.setpoint).toBe(FALLBACK.setpoint); // fell through to fallback beneath it
  });

  it("an expired override is ignored, falling through the rest of the chain", () => {
    const result = resolveZoneTargets({
      ...base(),
      manualOverride: {
        config: {
          kind: "setpoint",
          value: 20,
          hold_type: "permanent",
          actor: "Martin",
        },
        expiresAtMs: NOW - 1000,
        revokedAtMs: null,
      },
    });
    expect(result.source).toBe("fallback");
  });

  it("away wins over an active schedule event", () => {
    const result = resolveZoneTargets({
      ...base(),
      awaySource: {
        ecobeeAwayZoneIds: new Set(["z1"]),
        nativeAwayZoneIds: new Set(),
      },
      governingEvent: {
        mode: "active",
        coolSetpoint: asAbsoluteTemp(21),
        heatSetpoint: asAbsoluteTemp(19),
        toleranceOverride: null,
      },
    });
    expect(result.source).toBe("away");
    expect(result.setpoint).toBe(AWAY_TARGETS.setpoint);
  });

  it("an active schedule event picks the setpoint by call state", () => {
    const result = resolveZoneTargets({
      ...base(),
      governingEvent: {
        mode: "active",
        coolSetpoint: asAbsoluteTemp(21),
        heatSetpoint: asAbsoluteTemp(19),
        toleranceOverride: null,
      },
    });
    expect(result).toEqual({
      setpoint: 21,
      tolerance: null,
      source: "schedule",
      manualPositionPct: null,
    });
  });

  it("an active schedule event picks the heat setpoint during HEATING_CALL", () => {
    const result = resolveZoneTargets({
      ...base(),
      state: "HEATING_CALL",
      governingEvent: {
        mode: "active",
        coolSetpoint: asAbsoluteTemp(21),
        heatSetpoint: asAbsoluteTemp(19),
        toleranceOverride: null,
      },
    });
    expect(result.setpoint).toBe(19);
  });

  it("an inactive schedule event yields no target at all", () => {
    const result = resolveZoneTargets({
      ...base(),
      governingEvent: {
        mode: "inactive",
        coolSetpoint: null,
        heatSetpoint: null,
        toleranceOverride: null,
      },
    });
    expect(result).toEqual({
      setpoint: null,
      tolerance: null,
      source: "inactive",
      manualPositionPct: null,
    });
  });

  it("default_inactive true with no governing event yields inactive, not the fallback", () => {
    const result = resolveZoneTargets({ ...base(), defaultInactive: true });
    expect(result.source).toBe("inactive");
  });

  it("falls through to the global fallback when nothing else applies", () => {
    const result = resolveZoneTargets(base());
    expect(result).toEqual({
      setpoint: FALLBACK.setpoint,
      tolerance: null,
      source: "fallback",
      manualPositionPct: null,
    });
  });
});
