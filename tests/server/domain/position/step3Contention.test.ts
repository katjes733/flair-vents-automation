import { describe, it, expect } from "vitest";
import {
  rankZones,
  resolveContention,
  type ContentionZone,
} from "~/server/domain/position/step3Contention";

function zone(overrides: Partial<ContentionZone>): ContentionZone {
  return {
    zoneId: "z",
    desiredPosition: 100,
    floorPosition: 0,
    flowRateLps: 47,
    priorityRank: 0,
    bucket: "unoccupied",
    ...overrides,
  };
}

describe("rankZones", () => {
  it("partitions bucket-major, then by priority within a bucket", () => {
    const zones = [
      zone({ zoneId: "unocc-hi", bucket: "unoccupied", priorityRank: 0 }),
      zone({ zoneId: "spiking", bucket: "spiking", priorityRank: 5 }),
      zone({ zoneId: "occupied", bucket: "occupied", priorityRank: 1 }),
    ];
    const ranked = rankZones(zones).map((z) => z.zoneId);
    expect(ranked).toEqual(["spiking", "occupied", "unocc-hi"]);
  });

  it("appends zones absent from the priority list (Infinity rank) after ranked ones", () => {
    const zones = [
      zone({
        zoneId: "unranked",
        bucket: "unoccupied",
        priorityRank: Infinity,
      }),
      zone({ zoneId: "ranked", bucket: "unoccupied", priorityRank: 0 }),
    ];
    expect(rankZones(zones).map((z) => z.zoneId)).toEqual([
      "ranked",
      "unranked",
    ]);
  });
});

describe("resolveContention", () => {
  it("is inert when the aggregate is already below the cap", () => {
    const result = resolveContention([zone({ desiredPosition: 20 })], 1000);
    expect(result.insufficient).toBe(false);
    expect(Object.keys(result.reductions)).toHaveLength(0);
  });

  it("reduces the lowest-priority (last-ranked) zone first", () => {
    const ranked = [
      zone({ zoneId: "high-priority", desiredPosition: 100, flowRateLps: 50 }),
      zone({ zoneId: "low-priority", desiredPosition: 100, flowRateLps: 50 }),
    ];
    // Aggregate at 100/100 = 100 Lps; cap at 60 Lps requires reducing 40 Lps.
    const result = resolveContention(ranked, 60);
    expect(result.reductions["low-priority"]).toBeGreaterThan(0);
    expect(result.reductions["high-priority"]).toBeUndefined();
  });

  it("never reduces a zone below its own floor", () => {
    const ranked = [
      zone({
        zoneId: "z1",
        desiredPosition: 100,
        floorPosition: 50,
        flowRateLps: 50,
      }),
    ];
    const result = resolveContention(ranked, 0);
    expect(result.positions["z1"]).toBe(50);
    expect(result.insufficient).toBe(true);
  });

  it("flags insufficient when every zone at its floor still exceeds the cap", () => {
    const ranked = [
      zone({
        zoneId: "z1",
        desiredPosition: 100,
        floorPosition: 80,
        flowRateLps: 50,
      }),
    ];
    const result = resolveContention(ranked, 10);
    expect(result.insufficient).toBe(true);
  });
});
