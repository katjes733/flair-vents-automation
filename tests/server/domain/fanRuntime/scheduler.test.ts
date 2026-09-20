import { describe, expect, it } from "vitest";
import {
  bucketRuntimeByHour,
  feasibleTargetMinutes,
  isFanRuntimeConfigurationValid,
  selectNextFanBlock,
  type FanBlockPolicy,
} from "~/server/domain/fanRuntime/scheduler";

const HOUR = 60 * 60 * 1000;
const policy: FanBlockPolicy = {
  minBlockMinutes: 5,
  maxBlockMinutes: 15,
  maxStartsPerHour: 3,
  minGapMinutes: 15,
  maxTargetMinutesPerHour: 30,
};

function utcHour(hour: number): number {
  return Date.UTC(2026, 0, 1, hour);
}

describe("bucketRuntimeByHour", () => {
  it("splits intervals at hour boundaries and counts overlap once", () => {
    const buckets = bucketRuntimeByHour([
      {
        startMs: utcHour(12) + 55 * 60 * 1000,
        endMs: utcHour(13) + 8 * 60 * 1000,
        kind: "heat_cool",
      },
      {
        startMs: utcHour(13) + 2 * 60 * 1000,
        endMs: utcHour(13) + 5 * 60 * 1000,
        kind: "fan_only",
      },
    ]);

    expect(buckets).toEqual([
      {
        hourStartMs: utcHour(12),
        heatCoolSeconds: 5 * 60,
        fanOnlySeconds: 0,
        creditedSeconds: 5 * 60,
      },
      {
        hourStartMs: utcHour(13),
        heatCoolSeconds: 8 * 60,
        fanOnlySeconds: 3 * 60,
        creditedSeconds: 8 * 60,
      },
    ]);
  });

  it("merges overlapping intervals of the same kind", () => {
    const buckets = bucketRuntimeByHour([
      {
        startMs: utcHour(10),
        endMs: utcHour(10) + 10 * 60 * 1000,
        kind: "fan_only",
      },
      {
        startMs: utcHour(10) + 5 * 60 * 1000,
        endMs: utcHour(10) + 15 * 60 * 1000,
        kind: "fan_only",
      },
    ]);

    expect(buckets[0].fanOnlySeconds).toBe(15 * 60);
    expect(buckets[0].creditedSeconds).toBe(15 * 60);
  });
});

describe("fan runtime feasibility", () => {
  it("offers five-minute target options through the configured maximum", () => {
    expect(feasibleTargetMinutes({ minBlockMinutes: 5 }, policy)).toEqual([
      5, 10, 15, 20, 25, 30,
    ]);
  });

  it("filters targets below a higher air-handler minimum", () => {
    expect(feasibleTargetMinutes({ minBlockMinutes: 10 }, policy)).toEqual([
      10, 15, 20, 25, 30,
    ]);
  });

  it("rejects a target that cannot fit the block and gap envelope", () => {
    expect(
      isFanRuntimeConfigurationValid(
        { enabled: true, targetMinutesPerHour: 45, minBlockMinutes: 5 },
        { ...policy, maxTargetMinutesPerHour: 60 },
      ),
    ).toBe(false);
    expect(
      isFanRuntimeConfigurationValid(
        { enabled: true, targetMinutesPerHour: 30, minBlockMinutes: 5 },
        policy,
      ),
    ).toBe(true);
  });
});

describe("selectNextFanBlock", () => {
  it("runs the full minimum for a small remaining deficit", () => {
    expect(
      selectNextFanBlock(
        {
          durationMinutes: 0,
          startsThisHour: 0,
          targetMinutesPerHour: 15,
          creditedMinutes: 13,
          hourStartMs: utcHour(8),
          nowMs: utcHour(8) + 30 * 60 * 1000,
          lastFanOnlyEndMs: null,
        },
        policy,
      ),
    ).toEqual({ durationMinutes: 5, reason: "minimum_overshoot" });
  });

  it("limits a block to the maximum and respects the hard gap", () => {
    const hourStartMs = utcHour(8);
    expect(
      selectNextFanBlock(
        {
          durationMinutes: 0,
          startsThisHour: 0,
          targetMinutesPerHour: 30,
          creditedMinutes: 0,
          hourStartMs,
          nowMs: hourStartMs,
          lastFanOnlyEndMs: null,
        },
        policy,
      ),
    ).toEqual({ durationMinutes: 15, reason: "deficit" });

    expect(
      selectNextFanBlock(
        {
          durationMinutes: 0,
          startsThisHour: 1,
          targetMinutesPerHour: 30,
          creditedMinutes: 15,
          hourStartMs,
          nowMs: hourStartMs + 15 * 60 * 1000,
          lastFanOnlyEndMs: hourStartMs + 15 * 60 * 1000,
        },
        policy,
      ),
    ).toBeNull();
  });

  it("does not start a block that would cross the hour boundary", () => {
    const hourStartMs = utcHour(8);
    expect(
      selectNextFanBlock(
        {
          durationMinutes: 0,
          startsThisHour: 0,
          targetMinutesPerHour: 15,
          creditedMinutes: 0,
          hourStartMs,
          nowMs: hourStartMs + 57 * 60 * 1000,
          lastFanOnlyEndMs: null,
        },
        policy,
      ),
    ).toBeNull();
  });

  it("does not schedule after the start limit", () => {
    expect(
      selectNextFanBlock(
        {
          durationMinutes: 0,
          startsThisHour: 3,
          targetMinutesPerHour: 30,
          creditedMinutes: 0,
          hourStartMs: utcHour(8),
          nowMs: utcHour(8),
          lastFanOnlyEndMs: null,
        },
        policy,
      ),
    ).toBeNull();
  });
});

void HOUR;
