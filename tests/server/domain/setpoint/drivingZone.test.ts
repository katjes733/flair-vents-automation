import { describe, it, expect } from "vitest";
import {
  selectDrivingZone,
  resolveExplicitDrivingOverride,
  type DrivingZoneCandidate,
} from "~/server/domain/setpoint/drivingZone";

function candidate(
  overrides: Partial<DrivingZoneCandidate>,
): DrivingZoneCandidate {
  return {
    zoneId: "z",
    hasTemperatureSensor: true,
    stale: false,
    demanding: true,
    deviation: 1,
    priorityRank: 0,
    occupied: false,
    ...overrides,
  };
}

const hysteresis = { switchMarginC: 0.3, switchDwellTicks: 2 };

describe("selectDrivingZone — dynamic selection", () => {
  it("tracks the largest raw deviation among eligible zones", () => {
    const result = selectDrivingZone({
      candidates: [
        candidate({ zoneId: "small", deviation: 1 }),
        candidate({ zoneId: "large", deviation: 5 }),
      ],
      explicitOverrideZoneId: null,
      currentlyTracked: null,
      ticksSinceLeadChanged: 0,
      ...hysteresis,
    });
    expect(result).toEqual({ zoneId: "large", reason: "dynamic_worst_off" });
  });

  it("breaks ties by priority order, then occupancy", () => {
    const byPriority = selectDrivingZone({
      candidates: [
        candidate({ zoneId: "low-pri", deviation: 3, priorityRank: 5 }),
        candidate({ zoneId: "high-pri", deviation: 3, priorityRank: 0 }),
      ],
      explicitOverrideZoneId: null,
      currentlyTracked: null,
      ticksSinceLeadChanged: 0,
      ...hysteresis,
    });
    expect(byPriority.zoneId).toBe("high-pri");

    // Same tie, encountered in the opposite order — exercises the
    // "candidate's priority is worse, keep best" branch too.
    const byPriorityReversed = selectDrivingZone({
      candidates: [
        candidate({ zoneId: "high-pri", deviation: 3, priorityRank: 0 }),
        candidate({ zoneId: "low-pri", deviation: 3, priorityRank: 5 }),
      ],
      explicitOverrideZoneId: null,
      currentlyTracked: null,
      ticksSinceLeadChanged: 0,
      ...hysteresis,
    });
    expect(byPriorityReversed.zoneId).toBe("high-pri");

    // Equal deviation AND equal priority — occupancy is the final tiebreak.
    const byOccupancy = selectDrivingZone({
      candidates: [
        candidate({
          zoneId: "unoccupied",
          deviation: 3,
          priorityRank: 0,
          occupied: false,
        }),
        candidate({
          zoneId: "occupied",
          deviation: 3,
          priorityRank: 0,
          occupied: true,
        }),
      ],
      explicitOverrideZoneId: null,
      currentlyTracked: null,
      ticksSinceLeadChanged: 0,
      ...hysteresis,
    });
    expect(byOccupancy.zoneId).toBe("occupied");
  });

  it("does not switch on a single-tick lead below the dwell", () => {
    const result = selectDrivingZone({
      candidates: [
        candidate({ zoneId: "current", deviation: 2 }),
        candidate({ zoneId: "challenger", deviation: 2.5 }), // exceeds margin
      ],
      explicitOverrideZoneId: null,
      currentlyTracked: "current",
      ticksSinceLeadChanged: 0, // below dwell of 2
      ...hysteresis,
    });
    expect(result.zoneId).toBe("current");
  });

  it("switches once the margin persists past the dwell", () => {
    const result = selectDrivingZone({
      candidates: [
        candidate({ zoneId: "current", deviation: 2 }),
        candidate({ zoneId: "challenger", deviation: 2.5 }),
      ],
      explicitOverrideZoneId: null,
      currentlyTracked: "current",
      ticksSinceLeadChanged: 2,
      ...hysteresis,
    });
    expect(result.zoneId).toBe("challenger");
  });

  it("returns none_eligible when nothing qualifies", () => {
    const result = selectDrivingZone({
      candidates: [candidate({ demanding: false })],
      explicitOverrideZoneId: null,
      currentlyTracked: null,
      ticksSinceLeadChanged: 0,
      ...hysteresis,
    });
    expect(result).toEqual({ zoneId: null, reason: "none_eligible" });
  });
});

describe("selectDrivingZone — explicit override", () => {
  it("pins tracking regardless of which zone is actually worst-off", () => {
    const result = selectDrivingZone({
      candidates: [
        candidate({ zoneId: "worst-off", deviation: 10 }),
        candidate({ zoneId: "overridden", deviation: 1 }),
      ],
      explicitOverrideZoneId: "overridden",
      currentlyTracked: null,
      ticksSinceLeadChanged: 0,
      ...hysteresis,
    });
    expect(result).toEqual({
      zoneId: "overridden",
      reason: "explicit_override",
    });
  });

  it("falls through to dynamic selection, flagged, when the override is ineligible", () => {
    const result = selectDrivingZone({
      candidates: [
        candidate({ zoneId: "stale-override", stale: true }),
        candidate({ zoneId: "fallback", deviation: 3 }),
      ],
      explicitOverrideZoneId: "stale-override",
      currentlyTracked: null,
      ticksSinceLeadChanged: 0,
      ...hysteresis,
    });
    expect(result).toEqual({
      zoneId: "fallback",
      reason: "override_ineligible_fallback",
    });
  });
});

describe("resolveExplicitDrivingOverride", () => {
  it("prefers a schedule event's own override for this air handler over the global default", () => {
    const result = resolveExplicitDrivingOverride({
      airHandlerId: "ah1",
      eventOverridesByZone: [{ ah1: "event-zone" }, { ah1: "event-zone" }],
      globalOverride: "global-zone",
    });
    expect(result).toBe("event-zone");
  });

  it("falls back to the global override when no zone's governing event specifies one", () => {
    const result = resolveExplicitDrivingOverride({
      airHandlerId: "ah1",
      eventOverridesByZone: [undefined, null, {}],
      globalOverride: "global-zone",
    });
    expect(result).toBe("global-zone");
  });

  it("ignores an event override scoped to a different air handler", () => {
    const result = resolveExplicitDrivingOverride({
      airHandlerId: "ah1",
      eventOverridesByZone: [{ ah2: "event-zone" }],
      globalOverride: "global-zone",
    });
    expect(result).toBe("global-zone");
  });

  it("falls back to the global default when zones on the same handler disagree", () => {
    const result = resolveExplicitDrivingOverride({
      airHandlerId: "ah1",
      eventOverridesByZone: [{ ah1: "zone-a" }, { ah1: "zone-b" }],
      globalOverride: "global-zone",
    });
    expect(result).toBe("global-zone");
  });

  it("returns null when neither an event nor the global setting has an override", () => {
    const result = resolveExplicitDrivingOverride({
      airHandlerId: "ah1",
      eventOverridesByZone: [undefined],
      globalOverride: null,
    });
    expect(result).toBeNull();
  });
});
