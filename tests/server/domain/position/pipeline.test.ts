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
    fanOnlyIdleBaselinePosition: 100,
    thermalLoadFlags: [],
    flowRateLps: 47,
    manualVents: [],
    calibratedTemp: asAbsoluteTemp(25),
    resolvedSetpoint: asAbsoluteTemp(21),
    demandTolerance: null,
    overshootTolerance: null,
    occupied: false,
    staleOccupancy: false,
    staleReading: false,
    spiking: false,
    priorityRank: 0,
    lastCommandedTarget: null,
    // null here (no per-zone override) + settings.maxStepsPerTick's huge
    // 1000 cap below means the pipeline's own fallback resolves to an
    // effectively unlimited jump size — harmless, since no fixture in this
    // file sets lastCommandedTarget to a hard extreme (0/100) in the first
    // place, so dead-zone recovery never actually triggers here. See
    // step2Ramp.test.ts for the jump behavior itself.
    deadZoneRecoveryJumpPct: null,
    manualPositionPct: null,
    degraded: false,
    previousClassification: null,
    previousPendingClassification: null,
    previousPendingSinceMs: null,
    sleepModeActive: false,
    priorAnchorPositionPct: null,
    priorAnchorSinceMs: null,
    priorAnchorIsFanOnly: null,
    otherZoneStruggling: false,
    capacitySharingExempt: false,
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
  discretePositionStepPct: null,
  maxStepsPerTick: 1000,
  // "both" here is a harmless default for every pre-existing test in this
  // file (none of them ever set lastCommandedTarget to a hard extreme) —
  // the dedicated "dead-zone recovery" describe block below overrides
  // modulationStepPct/maxStepsPerTick to actually exercise it.
  deadZoneRecoveryDirection: "both" as const,
  // Zero dwell — every zone() fixture starts with previousClassification:
  // null anyway (immediate adoption regardless of stabilization minutes),
  // so these tests exercise Steps 1-3 without any hysteresis lag; the
  // hysteresis behavior itself gets its own dedicated describe block below.
  classificationStabilizationMinutes: 0,
  sleepQuietAnchorEnabled: false,
  reanchorIntervalMinutes: 60,
  capacitySharingEnabled: false,
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
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    const capped = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      nowMs: 0,
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
        calibratedTemp: asAbsoluteTemp(19.5),
        demandTolerance: asTempDelta(0.5),
        overshootTolerance: asTempDelta(0.5),
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
      nowMs: 0,
      settings,
      capLps: 1, // would force contention if the satisfied zone were a candidate
      floorLps: 0,
    });
    expect(result.classifications["satisfied"]).toBe("satisfied");
    // The satisfied zone closes proportionally toward its floor (see
    // step1DesiredPosition.ts's not-demanding branch) — it was never a
    // Step 3 candidate to reduce, regardless of what it closed to.
    // deviation=19.5-21=-1.5, overshootTolerance=0.5 -> the closing curve's
    // own zero point is the lower edge (setpoint-overshootTolerance=20.5),
    // so overshoot=1 against effectiveBand=1.67 (unboosted):
    // 100 - 100*(1/1.67) ≈ 40.12, quantized to the nearest modulationStepPct
    // (1%) by Step 2.
    expect(result.commandedPositions["satisfied"]).toBe(40);
  });
});

describe("computeZoneCommands — manual position override", () => {
  it("bypasses Steps 1-3 entirely, going straight to the overridden value", () => {
    const zones = [zone({ zoneId: "manual", manualPositionPct: 42 })];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 34,
    });
    expect(belowThreshold.insufficientFloor).toBe(false);

    const aboveThreshold = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
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
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    // unoccupied + active call -> min_vent_position floor (0)
    expect(result.commandedPositions["stale"]).toBe(0);
  });
});

describe("computeZoneCommands — FAN_ONLY baselines", () => {
  it("rests every smart vent at its own occupancy-scaled FAN_ONLY baseline with no Step 1 math", () => {
    const zones = [
      zone({
        zoneId: "z1",
        // Deliberately different from idleBaselinePosition (left at the
        // factory's own default) — proves FAN_ONLY reads its own
        // dedicated setting, not the comfort-idle one, even though both
        // exist on the same zone.
        idleBaselinePosition: 100,
        fanOnlyIdleBaselinePosition: 60,
      }),
    ];
    const result = computeZoneCommands({
      state: "FAN_ONLY",
      zones,
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    // unoccupied, non-active-call -> fanOnlyIdleBaselinePosition * unoccupiedIdleFactor
    // — FAN_ONLY circulates unconditioned air, so deviation-based math has
    // nothing to react to, unlike IDLE (see the describe block below).
    expect(result.commandedPositions["z1"]).toBe(30);
  });
});

// Regression coverage for two real, confirmed overnight incidents against
// the same decision, both documented in ADR-0003 (original + its update).
//
// Original incident: a satisfied bedroom zone in an active Sleep Mode
// window got yanked open toward fanOnlyIdleBaselinePosition every time the
// blower ran a brief FAN_ONLY stretch between compressor cycles — ten
// separate cycles in one night — because this whole FAN_ONLY branch used
// to run (and `continue`) before sleep_quiet_anchor's own logic ever got a
// chance to apply. Fixed by falling through to the same anchor-aware path
// IDLE already used.
//
// That fix over-corrected, though: it anchored a Sleep-Mode zone in
// genuine FAN_ONLY to the *comfort* curve's own step1 output (same as an
// ordinary idle/call gap), which trends toward minVentPosition — so a
// sleeping room stopped getting yanked open, but also never actually
// circulated air during FAN_ONLY at all, just held closed. Fixed again:
// a non-demanding Sleep-Mode zone during genuine FAN_ONLY now anchors to
// the fanOnlyIdleBaselinePosition-derived target instead — still held
// flat for the same anti-noise reason, just circulating rather than
// closed. Demanding is unaffected either way, by design (see below).
describe("computeZoneCommands — FAN_ONLY respects Sleep Mode", () => {
  it("opens a demanding zone proportionally during FAN_ONLY while Sleep Mode is active, instead of resting at the FAN_ONLY baseline", () => {
    const zones = [
      zone({
        zoneId: "z1",
        fanOnlyIdleBaselinePosition: 40,
        sleepModeActive: true,
        calibratedTemp: asAbsoluteTemp(25), // well above setpoint(21) -> demanding
      }),
    ];
    const result = computeZoneCommands({
      state: "FAN_ONLY",
      zones,
      nowMs: 0,
      settings: { ...settings, sleepQuietAnchorEnabled: true },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["z1"]).toBe("demanding");
    expect(result.commandedPositions["z1"]).toBeGreaterThan(40);
    // Demanding never anchors at all, in FAN_ONLY or otherwise — the
    // safety net for a night the AC genuinely can't keep up must always
    // run the full ramp, not get capped at a circulation baseline.
    expect(result.sleepQuietAnchors["z1"]).toEqual({
      positionPct: null,
      sinceMs: null,
      isFanOnly: null,
    });
  });

  it("rests at the (occupancy-scaled) FAN_ONLY baseline for a satisfied zone during FAN_ONLY while Sleep Mode is active — the update's own fix", () => {
    const zones = [
      zone({
        zoneId: "z1",
        fanOnlyIdleBaselinePosition: 60,
        sleepModeActive: true,
        occupied: false,
        minVentPosition: 0,
        calibratedTemp: asAbsoluteTemp(15), // well below setpoint(21) -> satisfied
        demandTolerance: asTempDelta(0.5),
        overshootTolerance: asTempDelta(0.5),
      }),
    ];
    const result = computeZoneCommands({
      state: "FAN_ONLY",
      zones,
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["z1"]).toBe("satisfied");
    // fanOnlyIdleBaselinePosition(60) * unoccupiedIdleFactor(0.5) — the
    // same target the ordinary (non-sleep) FAN_ONLY branch would compute,
    // not a proportionally-closing comfort-curve value.
    expect(result.commandedPositions["z1"]).toBe(30);
  });

  it("still rests at the FAN_ONLY baseline when Sleep Mode is not active — today's daytime circulation behavior is unchanged", () => {
    const zones = [
      zone({
        zoneId: "z1",
        idleBaselinePosition: 100,
        fanOnlyIdleBaselinePosition: 60,
        sleepModeActive: false,
      }),
    ];
    const result = computeZoneCommands({
      state: "FAN_ONLY",
      zones,
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z1"]).toBe(30); // fanOnlyIdleBaselinePosition(60) * unoccupiedIdleFactor(0.5)
  });

  // A real FAN_ONLY stretch is typically only a few minutes — far shorter
  // than reanchorIntervalMinutes (default 60) — so the interval-based
  // reanchor alone would almost never fire during one. Entering/leaving
  // FAN_ONLY must force its own reanchor, or a sleeping zone would keep
  // holding whichever target it last anchored to under the *other* mode
  // for the entire brief window.
  describe("mode-transition reanchor", () => {
    it("reanchors to the FAN_ONLY target immediately on entering FAN_ONLY, replacing a held comfort-curve anchor", () => {
      const result = computeZoneCommands({
        state: "FAN_ONLY",
        zones: [
          zone({
            fanOnlyIdleBaselinePosition: 80,
            occupied: false,
            sleepModeActive: true,
            calibratedTemp: asAbsoluteTemp(19),
            demandTolerance: asTempDelta(0.5),
            overshootTolerance: asTempDelta(0.5),
            // A comfort-curve anchor already held from before FAN_ONLY
            // started — explicitly recorded as such (isFanOnly: false).
            priorAnchorPositionPct: 40,
            priorAnchorSinceMs: 1000,
            priorAnchorIsFanOnly: false,
          }),
        ],
        nowMs: 1000 + 5 * 60000, // well inside the 60-min reanchor interval
        settings: {
          ...settings,
          sleepQuietAnchorEnabled: true,
          reanchorIntervalMinutes: 60,
        },
        capLps: 10000,
        floorLps: 0,
      });
      // fanOnlyIdleBaselinePosition(80) * unoccupiedIdleFactor(0.5) = 40 —
      // deliberately picked to coincide with the old anchor's own value,
      // so a passing commandedPositions assertion alone couldn't hide a
      // failure to actually reanchor; the isFanOnly/sinceMs check below
      // is what actually proves a fresh capture happened.
      expect(result.commandedPositions["z"]).toBe(40);
      expect(result.sleepQuietAnchors["z"]).toEqual({
        positionPct: 40,
        sinceMs: 1000 + 5 * 60000,
        isFanOnly: true,
      });
    });

    it("holds the FAN_ONLY anchor flat across ticks within the same continuing FAN_ONLY stretch", () => {
      const result = computeZoneCommands({
        state: "FAN_ONLY",
        zones: [
          zone({
            fanOnlyIdleBaselinePosition: 80,
            occupied: false,
            sleepModeActive: true,
            calibratedTemp: asAbsoluteTemp(10), // would compute very differently if unanchored
            demandTolerance: asTempDelta(0.5),
            overshootTolerance: asTempDelta(0.5),
            priorAnchorPositionPct: 40,
            priorAnchorSinceMs: 1000,
            priorAnchorIsFanOnly: true,
          }),
        ],
        nowMs: 1000 + 5 * 60000,
        settings: {
          ...settings,
          sleepQuietAnchorEnabled: true,
          reanchorIntervalMinutes: 60,
        },
        capLps: 10000,
        floorLps: 0,
      });
      expect(result.commandedPositions["z"]).toBe(40);
      expect(result.sleepQuietAnchors["z"]).toEqual({
        positionPct: 40,
        sinceMs: 1000,
        isFanOnly: true,
      });
    });

    it("reanchors back to the comfort-curve target immediately on leaving FAN_ONLY, replacing a held FAN_ONLY anchor", () => {
      const result = computeZoneCommands({
        state: "COOLING_CALL",
        zones: [
          zone({
            sleepModeActive: true,
            calibratedTemp: asAbsoluteTemp(19.5),
            demandTolerance: asTempDelta(0.5),
            overshootTolerance: asTempDelta(0.5),
            priorAnchorPositionPct: 80,
            priorAnchorSinceMs: 1000,
            priorAnchorIsFanOnly: true,
          }),
        ],
        nowMs: 1000 + 5 * 60000,
        settings: {
          ...settings,
          sleepQuietAnchorEnabled: true,
          reanchorIntervalMinutes: 60,
        },
        capLps: 10000,
        floorLps: 0,
      });
      // Same known-quantity satisfied fixture as the sleep-quiet-anchor
      // describe block below (deviation=-1.5, closeRatio≈0.599 against
      // effectiveBand=1.67) — desiredPosition ≈ 40.12, quantized to 40.
      expect(result.commandedPositions["z"]).toBe(40);
      expect(result.sleepQuietAnchors["z"]).toEqual({
        positionPct: expect.closeTo(40.12, 1),
        sinceMs: 1000 + 5 * 60000,
        isFanOnly: false,
      });
    });

    // Backward compatibility: an anchor already in progress from before
    // this fix shipped carries no persisted isFanOnly at all (null) — must
    // not force a reanchor just because the mode is unknown, or every such
    // zone would reanchor on its very next tick after deploy regardless of
    // whether anything actually changed.
    it("does not force a reanchor when the held anchor's own mode is unknown (predates this fix)", () => {
      const result = computeZoneCommands({
        state: "FAN_ONLY",
        zones: [
          zone({
            fanOnlyIdleBaselinePosition: 80,
            occupied: false,
            sleepModeActive: true,
            calibratedTemp: asAbsoluteTemp(19),
            demandTolerance: asTempDelta(0.5),
            overshootTolerance: asTempDelta(0.5),
            priorAnchorPositionPct: 40,
            priorAnchorSinceMs: 1000,
            priorAnchorIsFanOnly: null,
          }),
        ],
        nowMs: 1000 + 5 * 60000,
        settings: {
          ...settings,
          sleepQuietAnchorEnabled: true,
          reanchorIntervalMinutes: 60,
        },
        capLps: 10000,
        floorLps: 0,
      });
      expect(result.sleepQuietAnchors["z"]).toEqual({
        positionPct: 40,
        sinceMs: 1000,
        isFanOnly: null,
      });
    });
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
      nowMs: 0,
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
        demandTolerance: asTempDelta(0.5),
        overshootTolerance: asTempDelta(0.5),
      }),
    ];
    const result = computeZoneCommands({
      state: "IDLE",
      zones,
      nowMs: 0,
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
      demandTolerance: asTempDelta(0.5),
      overshootTolerance: asTempDelta(0.5),
    };
    const duringCall = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [zone(satisfiedZone)],
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    const duringIdle = computeZoneCommands({
      state: "IDLE",
      zones: [zone(satisfiedZone)],
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 0,
    });
    expect(duringIdle.commandedPositions["z1"]).toBe(
      duringCall.commandedPositions["z1"],
    );
  });
});

// Regression coverage for a real gap found live: a near-zero comfort
// tolerance combined with ordinary sensor noise (~±0.5°C observed) flipped
// a zone's raw classification every tick. Note that for a zone whose
// idle_baseline_position equals its max_vent_position (the exact real
// scenario — Martin Bedroom), the demanding and satisfied formulas both
// converge to exactly idleBaselinePosition right at/past the tolerance
// boundary (continuity by construction — see step1DesiredPosition.ts's own
// comment), so a held-vs-flipped classification doesn't change *that one
// tick's own desiredPosition* in this degenerate case; what it protects is
// whether the zone gets pulled into Step 3 contention at all on a blip
// that shouldn't count as genuine, sustained demand — see also
// minimum_comfort_tolerance_c, a separate, complementary fix that reduces
// how often noise crosses the boundary in the first place.
describe("computeZoneCommands — classification stabilization holds a noisy zone out of contention", () => {
  const noisyZone = {
    zoneId: "z1",
    idleBaselinePosition: 100,
    minVentPosition: 0,
    maxVentPosition: 100,
    demandTolerance: asTempDelta(0.05),
    overshootTolerance: asTempDelta(0.05),
    calibratedTemp: asAbsoluteTemp(21.15), // deviation 0.15 > demandTolerance 0.05 -> raw reads "demanding"
    resolvedSetpoint: asAbsoluteTemp(21),
    flowRateLps: 47,
  };

  it("holds the prior tick's stabilized classification against a single-tick noise blip, keeping it out of Step 3 contention", () => {
    const zones = [
      zone({
        ...noisyZone,
        previousClassification: "satisfied",
        previousPendingClassification: null,
        previousPendingSinceMs: null,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      nowMs: 1_000,
      settings: { ...settings, classificationStabilizationMinutes: 3 },
      capLps: 1, // would force contention if this zone were treated as demanding
      floorLps: 0,
    });
    expect(result.classifications["z1"]).toBe("satisfied");
    expect(result.contention).toBeNull();
    expect(result.classificationPending["z1"]).toEqual({
      value: "demanding",
      sinceMs: 1_000,
    });
  });

  it("adopts the raw classification once the dwell has fully elapsed, entering contention", () => {
    const zones = [
      zone({
        ...noisyZone,
        previousClassification: "satisfied",
        previousPendingClassification: "demanding",
        previousPendingSinceMs: 0,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      nowMs: 4 * 60_000, // 4 minutes past the pending-since anchor
      settings: { ...settings, classificationStabilizationMinutes: 3 },
      capLps: 1,
      floorLps: 0,
    });
    expect(result.classifications["z1"]).toBe("demanding");
    expect(result.contention).not.toBeNull();
    expect(result.classificationPending["z1"]).toEqual({
      value: null,
      sinceMs: null,
    });
  });
});

describe("computeZoneCommands — pressure floor clamp", () => {
  it("reopens zones (highest priority first) when the aggregate falls below the floor", () => {
    const zones = [
      zone({
        zoneId: "high",
        priorityRank: 0,
        // Well below the closing curve's own lower edge (setpoint -
        // tolerance/2 = 18.5) so both zones fully saturate to their floor
        // — satisfied, closes to floor.
        calibratedTemp: asAbsoluteTemp(10),
        demandTolerance: asTempDelta(2.5),
        overshootTolerance: asTempDelta(2.5),
        minVentPosition: 0,
        maxVentPosition: 100,
        flowRateLps: 100,
      }),
      zone({
        zoneId: "low",
        priorityRank: 1,
        calibratedTemp: asAbsoluteTemp(10),
        demandTolerance: asTempDelta(2.5),
        overshootTolerance: asTempDelta(2.5),
        minVentPosition: 0,
        maxVentPosition: 100,
        flowRateLps: 100,
      }),
    ];
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones,
      nowMs: 0,
      settings,
      capLps: 10000,
      floorLps: 100, // both satisfied zones close to 0 — floor forces a reopen
    });
    expect(result.pressureFloorClamped).toBe(true);
    expect(result.commandedPositions["high"]).toBeGreaterThan(0);
    expect(result.commandedPositions["low"]).toBe(0);
  });
});

// Real, confirmed overnight noise problem this fixes: a "satisfied" zone's
// continuous overshoot ramp still swings its position nearly end-to-end
// every ~15 minutes from sub-degree sensor noise alone, even though the
// room never stopped being comfortable — see sleep_quiet_anchor_enabled's
// own comment in systemSettings.ts. calibratedTemp=19.5/tolerance=1 is the
// same known-quantity satisfied fixture as the "join between classification
// and contention" describe block above (deviation=-1.5, overshoot=1,
// closeRatio≈0.599 against effectiveBand=1.67 unboosted) — desiredPosition
// ≈ 40.12, quantized by Step 2 (modulationStepPct=1) to 40.
describe("computeZoneCommands — sleep-mode quiet anchor", () => {
  const satisfiedZone = (overrides: Partial<PipelineZoneInput> = {}) =>
    zone({
      calibratedTemp: asAbsoluteTemp(19.5),
      demandTolerance: asTempDelta(0.5),
      overshootTolerance: asTempDelta(0.5),
      sleepModeActive: true,
      ...overrides,
    });

  it("captures an anchor the first time a satisfied zone computes a position, with sleep mode active", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [satisfiedZone()],
      nowMs: 1000,
      settings: { ...settings, sleepQuietAnchorEnabled: true },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(40);
    // The anchor stores step1's raw (pre-Step-2-rounding) ramp output, not
    // the quantized commandedPositions value — Step 2 re-quantizes it the
    // same way on every subsequent tick regardless.
    expect(result.sleepQuietAnchors["z"]?.sinceMs).toBe(1000);
    expect(result.sleepQuietAnchors["z"]?.positionPct).toBeCloseTo(40.12, 1);
  });

  it("holds the anchored position flat on a later satisfied tick, even though the live ramp would compute something else", () => {
    // A colder reading than the anchor tick's — the unanchored ramp would
    // compute ~10 here (deviation=-2, overshoot=1.5, closeRatio≈0.898,
    // desiredPosition≈10.2 quantized to 10), a clearly different value
    // from the frozen 40 if the anchor weren't holding.
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        satisfiedZone({
          calibratedTemp: asAbsoluteTemp(19),
          priorAnchorPositionPct: 40,
          priorAnchorSinceMs: 1000,
          priorAnchorIsFanOnly: false,
        }),
      ],
      nowMs: 1000 + 5 * 60000, // 5 min later — well inside the 60-min interval
      settings: {
        ...settings,
        sleepQuietAnchorEnabled: true,
        reanchorIntervalMinutes: 60,
      },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(40);
    expect(result.sleepQuietAnchors["z"]).toEqual({
      positionPct: 40,
      sinceMs: 1000,
      isFanOnly: false,
    });
  });

  it("re-anchors once the refresh interval has elapsed, even while continuously satisfied", () => {
    const nowMs = 1000 + 61 * 60000; // 61 min later — past the 60-min interval
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        satisfiedZone({
          calibratedTemp: asAbsoluteTemp(19),
          priorAnchorPositionPct: 40,
          priorAnchorSinceMs: 1000,
        }),
      ],
      nowMs,
      settings: {
        ...settings,
        sleepQuietAnchorEnabled: true,
        reanchorIntervalMinutes: 60,
      },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(10);
    expect(result.sleepQuietAnchors["z"]?.sinceMs).toBe(nowMs);
    expect(result.sleepQuietAnchors["z"]?.positionPct).toBeCloseTo(10.18, 1);
  });

  it("clears the anchor and runs the full ramp when demanding, regardless of sleep mode", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        zone({
          calibratedTemp: asAbsoluteTemp(30), // demanding — default fixture temp
          sleepModeActive: true,
          priorAnchorPositionPct: 40,
          priorAnchorSinceMs: 1000,
        }),
      ],
      nowMs: 1000 + 5 * 60000,
      settings: { ...settings, sleepQuietAnchorEnabled: true },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["z"]).toBe("demanding");
    expect(result.commandedPositions["z"]).toBe(100);
    expect(result.sleepQuietAnchors["z"]).toEqual({
      positionPct: null,
      sinceMs: null,
      isFanOnly: null,
    });
  });

  it("never anchors when sleep mode is inactive — daytime behavior is unchanged", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [satisfiedZone({ sleepModeActive: false })],
      nowMs: 1000,
      settings: { ...settings, sleepQuietAnchorEnabled: true },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(40);
    expect(result.sleepQuietAnchors["z"]).toEqual({
      positionPct: null,
      sinceMs: null,
      isFanOnly: null,
    });
  });

  it("never anchors when the feature is disabled — the kill switch fully reverts to the continuous ramp", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [satisfiedZone()],
      nowMs: 1000,
      settings: { ...settings, sleepQuietAnchorEnabled: false },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(40);
    expect(result.sleepQuietAnchors["z"]).toEqual({
      positionPct: null,
      sinceMs: null,
      isFanOnly: null,
    });
  });
});

// Real, confirmed gap found live: "Upstairs" ran at 190%+ of rated
// capacity all day, every sample — three demanding zones sharing the same
// fixed blower output as several manual_fixed_vent zones and a
// flair_smart_vent zone (Den Front) that sits pinned at its 100% idle
// baseline nearly permanently, since the closing ramp only engages once a
// zone overshoots *past* its tolerance band, never merely for being right
// at target (see step1DesiredPosition.ts). Nothing made a comfortable
// zone give up unclaimed headroom for a struggling sibling — this closes
// that gap.
describe("computeZoneCommands — capacity sharing", () => {
  // deviation=19.5-21=-1.5, tolerance=1 -> overshoot=1, closeRatio≈0.599,
  // desiredPosition≈40.12 -> quantized to 40 (same known fixture as the
  // "join between classification and contention" describe block above).
  const satisfiedZone = (overrides: Partial<PipelineZoneInput> = {}) =>
    zone({
      calibratedTemp: asAbsoluteTemp(19.5),
      demandTolerance: asTempDelta(0.5),
      overshootTolerance: asTempDelta(0.5),
      minVentPosition: 10,
      otherZoneStruggling: true,
      ...overrides,
    });

  it("pulls a satisfied, eligible zone down to its own min_vent_position when another zone is struggling", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [satisfiedZone()],
      nowMs: 0,
      settings: { ...settings, capacitySharingEnabled: true },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(10);
  });

  it("leaves an exempt zone on its own normal ramp even when another zone is struggling", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [satisfiedZone({ capacitySharingExempt: true })],
      nowMs: 0,
      settings: { ...settings, capacitySharingEnabled: true },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(46);
  });

  it("leaves a zone on its normal ramp when no other zone is struggling", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [satisfiedZone({ otherZoneStruggling: false })],
      nowMs: 0,
      settings: { ...settings, capacitySharingEnabled: true },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(46);
  });

  it("never applies to a demanding zone, regardless of another zone struggling", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        zone({
          calibratedTemp: asAbsoluteTemp(30), // demanding — default fixture temp
          minVentPosition: 10,
          otherZoneStruggling: true,
        }),
      ],
      nowMs: 0,
      settings: { ...settings, capacitySharingEnabled: true },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.classifications["z"]).toBe("demanding");
    expect(result.commandedPositions["z"]).toBe(100);
  });

  it("never pulls down a zone with an active Sleep Mode window, even with sleep_quiet_anchor_enabled off — quiet hours are unconditional", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [satisfiedZone({ sleepModeActive: true })],
      nowMs: 0,
      settings: {
        ...settings,
        capacitySharingEnabled: true,
        sleepQuietAnchorEnabled: false, // deliberately off — the regression this test guards
      },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(46);
  });

  it("is a no-op when the feature is disabled, even with an eligible struggling scenario", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [satisfiedZone()],
      nowMs: 0,
      settings: { ...settings, capacitySharingEnabled: false },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(46);
  });
});

// Exercises pipeline.ts's own deadZoneRecoveryJumpPct resolution at Step 2
// (`zone.deadZoneRecoveryJumpPct ?? effectivePositionStepPct *
// maxStepsPerTick`) — step2Ramp.test.ts already covers rampTowardTarget's
// jump behavior directly given an already-resolved value; these confirm
// computeZoneCommands actually resolves and passes that value through for
// a real demanding zone leaving a hard extreme.
describe("computeZoneCommands — dead-zone recovery", () => {
  it("jumps to the zone's own override when a demanding zone leaves a fully-closed vent", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        zone({
          zoneId: "z",
          lastCommandedTarget: 0,
          // A multiple of modulationStepPct below, so quantization can't
          // itself explain the result landing here.
          deadZoneRecoveryJumpPct: 50,
          calibratedTemp: asAbsoluteTemp(30), // well above setpoint — genuinely demanding, target far past 50
        }),
      ],
      nowMs: 0,
      settings: { ...settings, modulationStepPct: 10, maxStepsPerTick: 1 },
      capLps: 10000,
      floorLps: 0,
    });
    // An ordinary ramp from 0 with modulationStepPct=10/maxStepsPerTick=1
    // could only reach 10 this tick — 50 only appears because the jump
    // fired.
    expect(result.commandedPositions["z"]).toBe(50);
  });

  it("falls back to an ordinary max-size step when neither the zone nor the global setting resolves one", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        zone({
          zoneId: "z",
          lastCommandedTarget: 0,
          deadZoneRecoveryJumpPct: null,
          calibratedTemp: asAbsoluteTemp(30),
        }),
      ],
      nowMs: 0,
      settings: { ...settings, modulationStepPct: 10, maxStepsPerTick: 1 },
      capLps: 10000,
      floorLps: 0,
    });
    // No jump at all — same result as an ordinary ramp step would produce.
    expect(result.commandedPositions["z"]).toBe(10);
  });

  it("does not jump for a zone that was never resting at a hard extreme", () => {
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        zone({
          zoneId: "z",
          lastCommandedTarget: 20,
          deadZoneRecoveryJumpPct: 45,
          calibratedTemp: asAbsoluteTemp(30),
        }),
      ],
      nowMs: 0,
      settings: { ...settings, modulationStepPct: 10, maxStepsPerTick: 1 },
      capLps: 10000,
      floorLps: 0,
    });
    expect(result.commandedPositions["z"]).toBe(30);
  });

  it("respects settings.deadZoneRecoveryDirection — 'open' skips the jump when a zone is closing from fully-open", () => {
    // A satisfied, non-demanding zone closing toward its (default 100)
    // idle baseline from a fully-open rest — step2Ramp.test.ts's own
    // direction-gating tests cover the pure function exhaustively; this
    // confirms computeZoneCommands actually wires settings.deadZoneRecoveryDirection
    // through rather than silently defaulting to "both".
    const result = computeZoneCommands({
      state: "COOLING_CALL",
      zones: [
        zone({
          zoneId: "z",
          lastCommandedTarget: 100,
          deadZoneRecoveryJumpPct: 50,
          idleBaselinePosition: 20,
          calibratedTemp: asAbsoluteTemp(21), // right at setpoint — satisfied
        }),
      ],
      nowMs: 0,
      settings: {
        ...settings,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
        deadZoneRecoveryDirection: "open",
      },
      capLps: 10000,
      floorLps: 0,
    });
    // Ordinary one-step ramp toward the idle baseline, not the jump to 50.
    expect(result.commandedPositions["z"]).toBe(90);
  });
});
