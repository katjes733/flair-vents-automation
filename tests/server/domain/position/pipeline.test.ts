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
    assumedFixedPosition: null,
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
    // The satisfied zone rests at its (occupancy-scaled) idle baseline —
    // it was never a Step 3 candidate to reduce.
    expect(result.commandedPositions["satisfied"]).toBe(0); // min_vent_position floor, unoccupied+active call
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
  it("manual vents count in pressure math at their assumed position; no_vent is excluded", () => {
    const zones = [
      zone({
        zoneId: "manual",
        ventHardwareType: "manual_fixed_vent",
        assumedFixedPosition: 50,
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

describe("computeZoneCommands — IDLE/FAN_ONLY baselines", () => {
  it("rests every smart vent at its idle baseline with no Step 1 math", () => {
    const zones = [zone({ zoneId: "z1", idleBaselinePosition: 60 })];
    const result = computeZoneCommands({
      state: "IDLE",
      zones,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    // unoccupied, non-active-call -> idleBaselinePosition * unoccupiedIdleFactor
    expect(result.commandedPositions["z1"]).toBe(30);
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
