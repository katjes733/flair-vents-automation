import { describe, it, expect } from "vitest";
import {
  evaluateSpike,
  type SpikeHysteresisState,
  type SpikeReading,
} from "~/server/domain/sensors/spikeDetection";

const NOW = Date.UTC(2024, 0, 1, 12, 0);
const NOT_SPIKING: SpikeHysteresisState = {
  spiking: false,
  belowThresholdSinceMs: null,
};

const baseParams = {
  minSamples: 3,
  minSpanMinutes: 3,
  riseThresholdPerMin: 0.5,
  clearThresholdPerMin: 0.2,
  plausibilityCapPerMin: 3,
  previous: NOT_SPIKING,
  nowMs: NOW,
  stabilizationMinutes: 5,
};

function reading(minutesFromStart: number, temperatureC: number): SpikeReading {
  return { timestampMs: NOW + minutesFromStart * 60000, temperatureC };
}

describe("evaluateSpike", () => {
  it("does not read sparse/duplicate-then-jump readings as a compressed steep rise", () => {
    // Two nearly-simultaneous duplicate reads, then a jump that implies an
    // implausible instantaneous rate — a sync-recovery artifact, not a
    // real rise.
    const readings = [reading(0, 21), reading(0.01, 21), reading(0.02, 30)];
    const result = evaluateSpike({ ...baseParams, readings });
    expect(result.ratePerMin).toBeNull();
    expect(result.spiking).toBe(false);
  });

  it("still triggers on a genuinely irregular-but-real rise", () => {
    const readings = [reading(0, 21), reading(2, 22.5), reading(6, 25.5)];
    const result = evaluateSpike({ ...baseParams, readings });
    expect(result.ratePerMin).not.toBeNull();
    expect(result.spiking).toBe(true);
  });

  it("holds the previous state when there aren't enough samples or span to trust a slope", () => {
    const readings = [reading(0, 21), reading(0.5, 21.1)];
    const result = evaluateSpike({ ...baseParams, readings });
    expect(result.ratePerMin).toBeNull();
    expect(result.spiking).toBe(false);
  });

  it("stays not-spiking when the rate is already below the clear threshold", () => {
    const readings = [reading(0, 21), reading(2, 21.01), reading(6, 21.02)];
    const result = evaluateSpike({ ...baseParams, readings });
    expect(result.spiking).toBe(false);
    expect(result.belowThresholdSinceMs).toBeNull();
  });

  it("holds the previous state when the rate is between the clear and rise thresholds", () => {
    // ~0.3/min sits strictly between clearThreshold(0.2) and riseThreshold(0.5).
    const readings = [reading(0, 21), reading(3, 21.9), reading(6, 22.8)];
    const result = evaluateSpike({
      ...baseParams,
      readings,
      previous: NOT_SPIKING,
    });
    expect(result.ratePerMin).toBeCloseTo(0.3, 1);
    expect(result.spiking).toBe(false);
  });

  it("applies a hysteresis dwell before clearing", () => {
    const spikingState: SpikeHysteresisState = {
      spiking: true,
      belowThresholdSinceMs: null,
    };
    const readings = [reading(0, 21), reading(2, 21.1), reading(6, 21.2)]; // slow rate, below clear threshold
    const firstClearAttempt = evaluateSpike({
      ...baseParams,
      previous: spikingState,
      readings,
      nowMs: NOW,
    });
    expect(firstClearAttempt.spiking).toBe(true); // still spiking — dwell just started
    expect(firstClearAttempt.belowThresholdSinceMs).toBe(NOW);

    const afterDwell = evaluateSpike({
      ...baseParams,
      previous: firstClearAttempt,
      readings,
      nowMs: NOW + 5 * 60000,
    });
    expect(afterDwell.spiking).toBe(false);
  });
});
