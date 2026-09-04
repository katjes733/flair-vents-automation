import { describe, it, expect } from "vitest";
import {
  computeZoneCommands,
  type PipelineZoneInput,
} from "~/server/domain/position/pipeline";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";

function zone(overrides: Partial<PipelineZoneInput>): PipelineZoneInput {
  return {
    zoneId: "z",
    ventHardwareType: "flair_smart_vent",
    hasTemperatureSensor: true,
    minVentPosition: 0,
    maxVentPosition: 100,
    idleBaselinePosition: 100,
    thermalLoadFlags: [],
    flowRateLps: 47,
    manualVents: [],
    calibratedTemp: asAbsoluteTemp(25),
    resolvedSetpoint: asAbsoluteTemp(21),
    tolerance: null,
    occupied: false,
    staleOccupancy: false,
    staleReading: false,
    spiking: false,
    priorityRank: 0,
    lastCommandedTarget: null,
    manualPositionPct: null,
    degraded: false,
    ...overrides,
  };
}

const settings = {
  proportionalBandWidthC: asTempDelta(1.67),
  maxPositionPct: 100,
  modifierBoosts: {
    occupancy: 0.3,
    spike: 0.3,
    highInternalHeatLoad: 0.3,
    distantHighDuctLoss: 0.3,
  },
  heatingChokePositionPct: 20,
  unoccupiedIdleFactor: 0.5,
  // Fine-grained step with a huge per-tick cap: quantization stays a
  // no-op (step=1) while the ramp itself never limits movement, so these
  // tests isolate Steps 1/3 rather than Step 2's own ramp behavior.
  modulationStepPct: 1,
  maxStepsPerTick: 1000,
};

describe("computeZoneCommands — no contention", () => {
  it("each zone's position is independent of priority order", () => {
    const zones = [
      zone({
        zoneId: "a",
        priorityRank: 0,
        calibratedTemp: asAbsoluteTemp(30),
      }),
      zone({
        zoneId: "b",
        priorityRank: 1,
        calibratedTemp: asAbsoluteTemp(28),
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    const swappedPriority = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        { ...zones[0], priorityRank: 1 },
        { ...zones[1], priorityRank: 0 },
      ],
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["a"]).toBeCloseTo(
      swappedPriority.commandedPositions["a"],
      5,
    );
    expect(result.commandedPositions["b"]).toBeCloseTo(
      swappedPriority.commandedPositions["b"],
      5,
    );
  });
});

describe("computeZoneCommands — genuine contention", () => {
  it("reduces the lowest-priority zone first, preserving the higher-priority zone's Step 1 position", () => {
    const zones = [
      zone({
        zoneId: "high",
        priorityRank: 0,
        idleBaselinePosition: 0, // room to reduce toward — see step1DesiredPosition tests
        calibratedTemp: asAbsoluteTemp(30),
        flowRateLps: 100,
      }),
      zone({
        zoneId: "low",
        priorityRank: 1,
        idleBaselinePosition: 0,
        calibratedTemp: asAbsoluteTemp(30),
        flowRateLps: 100,
      }),
    ];
    const uncapped = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    const capped = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 100, // forces contention
      floorLps: 0,
    });
    expect(capped.commandedPositions["high"]).toBeCloseTo(
      uncapped.commandedPositions["high"],
      5,
    );
    expect(capped.commandedPositions["low"]).toBeLessThan(
      uncapped.commandedPositions["low"],
    );
    expect(capped.contention).not.toBeNull();
  });
});

describe("computeZoneCommands — the join between classification and contention", () => {
  it("a within-tolerance zone never appears in the ranking, regardless of priority", () => {
    const zones = [
      zone({
        zoneId: "satisfied",
        priorityRank: 0,
        calibratedTemp: asAbsoluteTemp(21),
        tolerance: asTempDelta(1),
      }),
      zone({
        zoneId: "demanding",
        priorityRank: 1,
        calibratedTemp: asAbsoluteTemp(30),
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 1, // would force contention if the satisfied zone were a candidate
      floorLps: 0,
    });
    expect(result.classifications["satisfied"]).toBe("satisfied");
    // The satisfied zone closes proportionally toward its floor (see
    // step1DesiredPosition.ts's not-demanding branch) — it was never a
    // Step 3 candidate to reduce, regardless of what it closed to.
    // deviation=0 (temp 21 == setpoint 21), tolerance=1, so overshoot=1
    // against effectiveBand=1.67 (unboosted): 100 - 100*(1/1.67) ≈ 40.12,
    // quantized to the nearest modulationStepPct (1%) by Step 2.
    expect(result.commandedPositions["satisfied"]).toBe(40);
  });
});

describe("computeZoneCommands — manual position override", () => {
  it("bypasses Steps 1-3 entirely, going straight to the overridden value", () => {
    const zones = [zone({ zoneId: "manual", manualPositionPct: 42 })];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["manual"]).toBe(42);
    expect(result.classifications["manual"]).toBeUndefined();
  });
});

describe("computeZoneCommands — mixed vent hardware", () => {
  it("manual vents count in pressure math at their own position; no_vent is excluded", () => {
    const zones = [
      zone({
        zoneId: "manual",
        ventHardwareType: "manual_fixed_vent",
        manualVents: [{ position: 50, flowRateLps: 47 }],
      }),
      zone({ zoneId: "novent", ventHardwareType: "no_vent" }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["manual"]).toBe(50);
    expect(result.commandedPositions["novent"]).toBeUndefined();
  });

  // Regression coverage for "Multi-Vent Manual Zones": a manual_fixed_vent
  // zone's vents can each sit at a genuinely different position with a
  // different rating — the aggregate must sum each vent's own real
  // contribution (0.75*40 + 0.25*20 = 35), not a plain average position
  // times a combined flow rate, which would happen to agree here only by
  // coincidence of the exact math chosen — asserted via the floor-clamp
  // threshold since the raw aggregate isn't itself part of the return
  // value.
  it("sums each manual vent's own position/rating for the pressure aggregate, not an average", () => {
    const zones = [
      zone({
        zoneId: "manual",
        ventHardwareType: "manual_fixed_vent",
        manualVents: [
          { position: 75, flowRateLps: 40 },
          { position: 25, flowRateLps: 20 },
        ],
      }),
    ];
    const belowThreshold = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 34,
    });
    expect(belowThreshold.insufficientFloor).toBe(false);

    const aboveThreshold = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 36,
    });
    // No flair_smart_vent zone exists to reopen — the aggregate genuinely
    // can't reach a floor above its real (35) total.
    expect(aboveThreshold.insufficientFloor).toBe(true);
  });

  // Regression coverage: the pressure-floor clamp used to be able to
  // "reopen" a manual_fixed_vent zone the same way it reopens an
  // adjustable flair_smart_vent — nonsensical, since nothing can actually
  // dispatch a new position to a vent someone set by hand. A
  // manual_fixed_vent zone must never appear as a reopen candidate, even
  // when it has real room to open further (position below its own max).
  it("never reopens a manual_fixed_vent zone to help meet the pressure floor", () => {
    const zones = [
      zone({
        zoneId: "manual",
        ventHardwareType: "manual_fixed_vent",
        manualVents: [{ position: 10, flowRateLps: 47 }],
        maxVentPosition: 100,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 10000, // unreachable — forces the clamp to look for candidates
    });
    // The manual zone's own commanded position (informational only) is
    // untouched by the clamp; there was simply nothing eligible to reopen.
    expect(result.commandedPositions["manual"]).toBe(10);
    expect(result.insufficientFloor).toBe(true);
  });
});

describe("computeZoneCommands — classification for zones with no position math", () => {
  // Regression test: a no_vent/manual_fixed_vent zone has nothing to
  // position, but its comfort classification still applies "iff
  // sensored" per the Zone Hardware & Sensor Type Matrix — found live,
  // via a sensored, vent-less imported zone showing no reading/
  // classification in the UI at all. Previously these types were `continue`d
  // out of the loop before classification ever ran, so `classifications`
  // had no entry for them whatsoever.
  it("classifies a demanding no_vent zone despite having no vent to command", () => {
    const zones = [
      zone({
        zoneId: "novent",
        ventHardwareType: "no_vent",
        calibratedTemp: asAbsoluteTemp(25),
        resolvedSetpoint: asAbsoluteTemp(21),
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["novent"]).toBe("demanding");
    expect(result.commandedPositions["novent"]).toBeUndefined();
  });

  it("classifies a satisfied manual_fixed_vent zone despite having a fixed position", () => {
    const zones = [
      zone({
        zoneId: "manual",
        ventHardwareType: "manual_fixed_vent",
        manualVents: [{ position: 50, flowRateLps: 47 }],
        calibratedTemp: asAbsoluteTemp(21),
        resolvedSetpoint: asAbsoluteTemp(21),
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["manual"]).toBe("satisfied");
    expect(result.commandedPositions["manual"]).toBe(50);
  });

  it("classifies an unsensored no_vent zone as unclassified_no_sensor, not silently omitted", () => {
    const zones = [
      zone({
        zoneId: "novent",
        ventHardwareType: "no_vent",
        hasTemperatureSensor: false,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["novent"]).toBe("unclassified_no_sensor");
  });

  it("marks a no_vent zone with no resolved setpoint as inactive", () => {
    const zones = [
      zone({
        zoneId: "novent",
        ventHardwareType: "no_vent",
        resolvedSetpoint: null,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["novent"]).toBe("inactive");
  });

  it("marks a stale-reading no_vent zone as unclassified_no_sensor", () => {
    const zones = [
      zone({
        zoneId: "novent",
        ventHardwareType: "no_vent",
        staleReading: true,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["novent"]).toBe("unclassified_no_sensor");
  });
});

describe("computeZoneCommands — inactive and stale zones", () => {
  it("an inactive zone (no resolved setpoint) rests at its plain idle baseline", () => {
    const zones = [
      zone({
        zoneId: "inactive",
        resolvedSetpoint: null,
        idleBaselinePosition: 40,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["inactive"]).toBe("inactive");
    expect(result.commandedPositions["inactive"]).toBe(40);
  });

  it("a stale-reading zone is excluded from Steps 1-3 and forced to its (occupancy-scaled) idle baseline", () => {
    const zones = [
      zone({
        zoneId: "stale",
        staleReading: true,
        idleBaselinePosition: 80,
        calibratedTemp: asAbsoluteTemp(30), // would otherwise be demanding
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    // unoccupied + active call -> min_vent_position floor (0)
    expect(result.commandedPositions["stale"]).toBe(0);
  });
});

describe("computeZoneCommands — FAN_ONLY baselines", () => {
  it("rests every smart vent at its occupancy-scaled idle baseline with no Step 1 math", () => {
    const zones = [zone({ zoneId: "z1", idleBaselinePosition: 60 })];
    const result = computeZoneCommands({
      state: "FAN_ONLY",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    // unoccupied, non-active-call -> idleBaselinePosition * unoccupiedIdleFactor
    // — FAN_ONLY circulates unconditioned air, so deviation-based math has
    // nothing to react to, unlike IDLE (see the describe block below).
    expect(result.commandedPositions["z1"]).toBe(30);
  });
});

// Regression coverage for a real gap found live: a satisfied zone was
// getting shoved back open to idle_baseline_position every time the
// compressor cycled to IDLE, then had to re-close from scratch next
// cycle — a short-cycling system never let it settle. IDLE now runs the
// identical proportional math a real call would, using the same
// arbitrary-but-harmless cooling-direction default the classification
// label already used, so a zone's position doesn't reset just because
// nothing happens to be calling for cooling at this exact instant.
describe("computeZoneCommands — IDLE runs the same proportional math as an active call", () => {
  it("opens a demanding zone proportionally instead of resting flat at idle baseline", () => {
    const zones = [
      zone({
        zoneId: "z1",
        idleBaselinePosition: 60,
        calibratedTemp: asAbsoluteTemp(25), // well above setpoint(21) -> demanding
      }),
    ];
    const result = computeZoneCommands({
      state: "IDLE",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["z1"]).toBe("demanding");
    expect(result.commandedPositions["z1"]).toBeGreaterThan(60);
  });

  it("closes a satisfied zone proportionally instead of resting flat at idle baseline", () => {
    const zones = [
      zone({
        zoneId: "z1",
        idleBaselinePosition: 100,
        minVentPosition: 0,
        calibratedTemp: asAbsoluteTemp(15), // well below setpoint(21) -> satisfied, closing
        tolerance: asTempDelta(1),
      }),
    ];
    const result = computeZoneCommands({
      state: "IDLE",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["z1"]).toBe("satisfied");
    expect(result.commandedPositions["z1"]).toBeLessThan(100);
  });

  it("computes the identical position for a satisfied zone whether the call is genuinely active or the compressor just cycled to idle", () => {
    const satisfiedZone = {
      zoneId: "z1",
      idleBaselinePosition: 100,
      minVentPosition: 0,
      calibratedTemp: asAbsoluteTemp(18),
      tolerance: asTempDelta(1),
    };
    const duringCall = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [zone(satisfiedZone)],
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    const duringIdle = computeZoneCommands({
      state: "IDLE",
      zones: [zone(satisfiedZone)],
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(duringIdle.commandedPositions["z1"]).toBe(
      duringCall.commandedPositions["z1"],
    );
  });
});

describe("computeZoneCommands — pressure floor clamp", () => {
  it("reopens zones (highest priority first) when the aggregate falls below the floor", () => {
    const zones = [
      zone({
        zoneId: "high",
        priorityRank: 0,
        calibratedTemp: asAbsoluteTemp(21),
        tolerance: asTempDelta(5), // satisfied, closes to floor
        minVentPosition: 0,
        maxVentPosition: 100,
        flowRateLps: 100,
      }),
      zone({
        zoneId: "low",
        priorityRank: 1,
        calibratedTemp: asAbsoluteTemp(21),
        tolerance: asTempDelta(5),
        minVentPosition: 0,
        maxVentPosition: 100,
        flowRateLps: 100,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      settings,
      capLps: 10000,
      floorLps: 100, // both satisfied zones close to 0 — floor forces a reopen
    });
    expect(result.pressureFloorClamped).toBe(true);
    expect(result.commandedPositions["high"]).toBeGreaterThan(0);
    expect(result.commandedPositions["low"]).toBe(0);
  });
});
