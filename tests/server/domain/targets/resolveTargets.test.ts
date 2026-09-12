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
    observationOnly: false,
    manualOverride: null,
    awaySource: NO_AWAY,
    awayTargets: AWAY_TARGETS,
    governingEvent: null,
    defaultInactive: false,
    fallback: FALLBACK,
    zoneDemandTolerance: null,
    zoneOvershootTolerance: null,
    state: "COOLING_CALL" as const,
    minimumComfortTolerance: asTempDelta(0),
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
      demandTolerance: null,
      overshootTolerance: null,
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
        demandToleranceOverride: null,
        overshootToleranceOverride: null,
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
        demandToleranceOverride: null,
        overshootToleranceOverride: null,
      },
    });
    expect(result).toEqual({
      setpoint: 21,
      demandTolerance: null,
      overshootTolerance: null,
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
        demandToleranceOverride: null,
        overshootToleranceOverride: null,
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
        demandToleranceOverride: null,
        overshootToleranceOverride: null,
      },
    });
    expect(result).toEqual({
      setpoint: null,
      demandTolerance: null,
      overshootTolerance: null,
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
      demandTolerance: null,
      overshootTolerance: null,
      source: "fallback",
      manualPositionPct: null,
    });
  });

  describe("an event's own demand/overshoot tolerance overrides win independently", () => {
    it("applies each override side independently, falling back to the zone default per-side", () => {
      const result = resolveZoneTargets({
        ...base(),
        zoneDemandTolerance: asTempDelta(1),
        zoneOvershootTolerance: asTempDelta(2),
        governingEvent: {
          mode: "active",
          coolSetpoint: asAbsoluteTemp(21),
          heatSetpoint: asAbsoluteTemp(19),
          demandToleranceOverride: asTempDelta(3),
          overshootToleranceOverride: null,
        },
      });
      expect(result.demandTolerance).toBe(3);
      expect(result.overshootTolerance).toBe(2);
    });
  });

  describe("minimum comfort tolerance floor", () => {
    it("floors an unset schedule-event demand tolerance up to the minimum, leaving overshoot unset", () => {
      const result = resolveZoneTargets({
        ...base(),
        minimumComfortTolerance: asTempDelta(0.56),
        governingEvent: {
          mode: "active",
          coolSetpoint: asAbsoluteTemp(21),
          heatSetpoint: asAbsoluteTemp(19),
          demandToleranceOverride: null,
          overshootToleranceOverride: null,
        },
      });
      expect(result.demandTolerance).toBe(0.56);
      expect(result.overshootTolerance).toBeNull();
    });

    it("floors a small explicit demand tolerance up to the minimum", () => {
      const result = resolveZoneTargets({
        ...base(),
        minimumComfortTolerance: asTempDelta(0.56),
        governingEvent: {
          mode: "active",
          coolSetpoint: asAbsoluteTemp(21),
          heatSetpoint: asAbsoluteTemp(19),
          demandToleranceOverride: asTempDelta(0.1),
          overshootToleranceOverride: null,
        },
      });
      expect(result.demandTolerance).toBe(0.56);
    });

    it("leaves an already-wide demand tolerance untouched", () => {
      const result = resolveZoneTargets({
        ...base(),
        minimumComfortTolerance: asTempDelta(0.56),
        governingEvent: {
          mode: "active",
          coolSetpoint: asAbsoluteTemp(21),
          heatSetpoint: asAbsoluteTemp(19),
          demandToleranceOverride: asTempDelta(1.5),
          overshootToleranceOverride: null,
        },
      });
      expect(result.demandTolerance).toBe(1.5);
    });

    it("never floors the overshoot tolerance, even when explicitly zero", () => {
      const result = resolveZoneTargets({
        ...base(),
        minimumComfortTolerance: asTempDelta(0.56),
        governingEvent: {
          mode: "active",
          coolSetpoint: asAbsoluteTemp(21),
          heatSetpoint: asAbsoluteTemp(19),
          demandToleranceOverride: null,
          overshootToleranceOverride: asTempDelta(0),
        },
      });
      expect(result.overshootTolerance).toBe(0);
    });

    it("does not apply to an inactive resolution — no setpoint means no tolerance to floor", () => {
      const result = resolveZoneTargets({
        ...base(),
        minimumComfortTolerance: asTempDelta(0.56),
        governingEvent: {
          mode: "inactive",
          coolSetpoint: null,
          heatSetpoint: null,
          demandToleranceOverride: null,
          overshootToleranceOverride: null,
        },
      });
      expect(result.setpoint).toBeNull();
      expect(result.demandTolerance).toBeNull();
      expect(result.overshootTolerance).toBeNull();
    });

    it("applies to a manual setpoint override's own demand tolerance too", () => {
      const result = resolveZoneTargets({
        ...base(),
        minimumComfortTolerance: asTempDelta(0.56),
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
      });
      expect(result.demandTolerance).toBe(0.56);
    });
  });

  describe("observation_only", () => {
    it("wins over everything else, including a manual override", () => {
      const result = resolveZoneTargets({
        ...base(),
        observationOnly: true,
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
        governingEvent: {
          mode: "active",
          coolSetpoint: asAbsoluteTemp(22),
          heatSetpoint: asAbsoluteTemp(20),
          demandToleranceOverride: null,
          overshootToleranceOverride: null,
        },
      });
      expect(result.setpoint).toBeNull();
      expect(result.demandTolerance).toBeNull();
      expect(result.overshootTolerance).toBeNull();
      expect(result.source).toBe("observation_only");
      expect(result.manualPositionPct).toBeNull();
    });

    it("wins over Away Mode too", () => {
      const result = resolveZoneTargets({
        ...base(),
        observationOnly: true,
        awaySource: {
          ecobeeAwayZoneIds: new Set(["z1"]),
          nativeAwayZoneIds: new Set(),
        },
      });
      expect(result.setpoint).toBeNull();
      expect(result.source).toBe("observation_only");
    });
  });
});
