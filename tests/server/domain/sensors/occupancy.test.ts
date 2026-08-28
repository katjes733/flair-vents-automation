import { describe, it, expect } from "vitest";
import {
  evaluateOccupancy,
  effectiveIdleBaseline,
  type OccupancyHysteresisState,
} from "~/server/domain/sensors/occupancy";

const NOW = Date.UTC(2024, 0, 1, 12, 0);
const UNOCCUPIED: OccupancyHysteresisState = {
  occupied: false,
  pendingFlipSince: null,
};

describe("evaluateOccupancy", () => {
  it("is always unoccupied without an occupancy sensor", () => {
    expect(
      evaluateOccupancy({
        hasOccupancySensor: false,
        rawOccupied: true,
        stale: false,
        previous: UNOCCUPIED,
        nowMs: NOW,
        stabilizationMinutes: 5,
      }),
    ).toEqual({ occupied: false, pendingFlipSince: null });
  });

  it("holds the previous state while stale", () => {
    const previous: OccupancyHysteresisState = {
      occupied: true,
      pendingFlipSince: null,
    };
    expect(
      evaluateOccupancy({
        hasOccupancySensor: true,
        rawOccupied: false,
        stale: true,
        previous,
        nowMs: NOW,
        stabilizationMinutes: 5,
      }),
    ).toEqual(previous);
  });

  it("does not flip on a single flickering reading below the dwell", () => {
    const flipped = evaluateOccupancy({
      hasOccupancySensor: true,
      rawOccupied: true,
      stale: false,
      previous: UNOCCUPIED,
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    expect(flipped.occupied).toBe(false);
    expect(flipped.pendingFlipSince).toBe(NOW);
  });

  it("clears a pending flip once the raw reading matches the previous state again", () => {
    const pending: OccupancyHysteresisState = {
      occupied: false,
      pendingFlipSince: NOW - 60000,
    };
    const result = evaluateOccupancy({
      hasOccupancySensor: true,
      rawOccupied: false, // reverted back before the dwell elapsed
      stale: false,
      previous: pending,
      nowMs: NOW,
      stabilizationMinutes: 5,
    });
    expect(result).toEqual({ occupied: false, pendingFlipSince: null });
  });

  it("flips once the dwell has persisted", () => {
    const pending: OccupancyHysteresisState = {
      occupied: false,
      pendingFlipSince: NOW,
    };
    const laterMs = NOW + 5 * 60000;
    const flipped = evaluateOccupancy({
      hasOccupancySensor: true,
      rawOccupied: true,
      stale: false,
      previous: pending,
      nowMs: laterMs,
      stabilizationMinutes: 5,
    });
    expect(flipped).toEqual({ occupied: true, pendingFlipSince: null });
  });
});

describe("effectiveIdleBaseline", () => {
  const base = {
    idleBaselinePosition: 100,
    minVentPosition: 0,
    maxVentPosition: 100,
    unoccupiedIdleFactor: 0.5,
  };

  it("closes to the min_vent_position floor when satisfied, unoccupied, and the call is active", () => {
    expect(
      effectiveIdleBaseline({
        ...base,
        minVentPosition: 10,
        occupied: false,
        staleOccupancy: false,
        callActive: true,
      }),
    ).toBe(10);
  });

  it("applies the gentler unoccupiedIdleFactor only during FAN_ONLY/IDLE", () => {
    expect(
      effectiveIdleBaseline({
        ...base,
        occupied: false,
        staleOccupancy: false,
        callActive: false,
      }),
    ).toBe(50);
  });

  it("uses the plain baseline when occupied, in either state", () => {
    expect(
      effectiveIdleBaseline({
        ...base,
        occupied: true,
        staleOccupancy: false,
        callActive: true,
      }),
    ).toBe(100);
    expect(
      effectiveIdleBaseline({
        ...base,
        occupied: true,
        staleOccupancy: false,
        callActive: false,
      }),
    ).toBe(100);
  });

  it("falls back to the plain, unscaled baseline when occupancy is stale, in either state", () => {
    expect(
      effectiveIdleBaseline({
        ...base,
        occupied: false,
        staleOccupancy: true,
        callActive: true,
      }),
    ).toBe(100);
    expect(
      effectiveIdleBaseline({
        ...base,
        occupied: false,
        staleOccupancy: true,
        callActive: false,
      }),
    ).toBe(100);
  });
});
