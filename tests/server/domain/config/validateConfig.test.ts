import { describe, it, expect } from "vitest";
import {
  validateZoneConfig,
  validateAirHandlerConfig,
  validateStepDeltaRelationship,
  validateSleepModeStepDelta,
  validatePriorityOrder,
} from "~/server/domain/config/validateConfig";

function zoneConfig(overrides = {}) {
  return {
    ventHardwareType: "flair_smart_vent" as const,
    flairRoomId: null,
    flairVentIds: ["vent-1"],
    manualVents: [] as Array<{
      position: number;
      ductFlowRateLps: number | undefined;
    }>,
    minVentPosition: 0,
    maxVentPosition: 100,
    idleBaselinePosition: 100,
    ...overrides,
  };
}

describe("validateZoneConfig", () => {
  it("passes a well-formed smart-vent zone", () => {
    expect(validateZoneConfig(zoneConfig())).toEqual([]);
  });

  // Regression coverage for a real house-specific correction: earlier,
  // this rule rejected flair_room_id on a manual_fixed_vent zone,
  // reasoning that a manual vent has no reason to track live Flair room
  // data. That's wrong for a room whose vent is a plain, non-Flair
  // vent but whose temperature/occupancy still comes from a real,
  // Flair-tracked remote sensor — flair_room_id only ever anchors
  // sensor data, independent of the vent's own hardware, so no vent
  // hardware type should be rejected for having one linked.
  it("allows flair_room_id on a manual_fixed_vent zone — a real vent Flair doesn't control, with a Flair-tracked sensor", () => {
    const issues = validateZoneConfig(
      zoneConfig({
        ventHardwareType: "manual_fixed_vent",
        flairRoomId: "room-1",
        manualVents: [{ position: 50, ductFlowRateLps: undefined }],
        flairVentIds: [],
      }),
    );
    expect(
      issues.some(
        (i) => i.code === "flair_room_requires_smart_vent_or_no_vent",
      ),
    ).toBe(false);
  });

  it("allows flair_room_id on a no_vent zone — a sensored, vent-less Flair room", () => {
    const issues = validateZoneConfig(
      zoneConfig({
        ventHardwareType: "no_vent",
        flairRoomId: "room-1",
        flairVentIds: [],
      }),
    );
    expect(
      issues.some(
        (i) => i.code === "flair_room_requires_smart_vent_or_no_vent",
      ),
    ).toBe(false);
  });

  it("requires at least one manual vent for manual_fixed_vent", () => {
    const issues = validateZoneConfig(
      zoneConfig({ ventHardwareType: "manual_fixed_vent" }),
    );
    expect(issues.some((i) => i.code === "manual_vents_required")).toBe(true);
  });

  it("rejects manual_vents on any other type", () => {
    const issues = validateZoneConfig(
      zoneConfig({
        manualVents: [{ position: 50, ductFlowRateLps: undefined }],
      }),
    );
    expect(issues.some((i) => i.code === "manual_vents_not_applicable")).toBe(
      true,
    );
  });

  // Regression coverage for modeling a real gap: a manual_fixed_vent zone
  // can have more than one physical vent, each at a genuinely different
  // position (a real house confirmed both its bathrooms and its Den back
  // each have 2), which the app previously had no way to represent at all.
  it("allows more than one manual vent for a manual_fixed_vent zone", () => {
    const issues = validateZoneConfig(
      zoneConfig({
        ventHardwareType: "manual_fixed_vent",
        manualVents: [
          { position: 75, ductFlowRateLps: undefined },
          { position: 25, ductFlowRateLps: 40 },
        ],
      }),
    );
    expect(issues.some((i) => i.code === "manual_vents_required")).toBe(false);
    expect(issues.some((i) => i.code === "manual_vents_not_applicable")).toBe(
      false,
    );
  });

  it("rejects min exceeding max", () => {
    const issues = validateZoneConfig(
      zoneConfig({ minVentPosition: 60, maxVentPosition: 40 }),
    );
    expect(issues.some((i) => i.code === "min_exceeds_max")).toBe(true);
  });

  it("requires at least one flair_vent_id for a flair_smart_vent zone", () => {
    const issues = validateZoneConfig(zoneConfig({ flairVentIds: [] }));
    expect(
      issues.some((i) => i.code === "flair_smart_vent_requires_vent_ids"),
    ).toBe(true);
  });

  it("rejects flair_vent_ids on a non-smart-vent zone", () => {
    const issues = validateZoneConfig(
      zoneConfig({
        ventHardwareType: "no_vent",
        flairVentIds: ["vent-1"],
      }),
    );
    expect(issues.some((i) => i.code === "flair_vent_ids_not_applicable")).toBe(
      true,
    );
  });

  it("rejects idle_baseline_position outside [min,max] rather than clamping it", () => {
    const issues = validateZoneConfig(
      zoneConfig({
        minVentPosition: 0,
        maxVentPosition: 50,
        idleBaselinePosition: 80,
      }),
    );
    expect(issues.some((i) => i.code === "idle_baseline_out_of_range")).toBe(
      true,
    );
  });
});

describe("validateAirHandlerConfig", () => {
  it("requires tonnage_tons before an air handler can be active", () => {
    const issues = validateAirHandlerConfig({
      active: true,
      tonnageTons: undefined,
    });
    expect(issues.some((i) => i.code === "tonnage_required_when_active")).toBe(
      true,
    );
  });

  it("does not require tonnage_tons for an inactive air handler", () => {
    const issues = validateAirHandlerConfig({
      active: false,
      tonnageTons: undefined,
    });
    expect(issues).toEqual([]);
  });

  it("accepts a real tonnage within sanity bounds", () => {
    expect(validateAirHandlerConfig({ active: true, tonnageTons: 5 })).toEqual(
      [],
    );
  });

  it("rejects an out-of-range tonnage", () => {
    expect(
      validateAirHandlerConfig({ active: true, tonnageTons: 0.1 }).some(
        (i) => i.code === "tonnage_out_of_range",
      ),
    ).toBe(true);
    expect(
      validateAirHandlerConfig({ active: true, tonnageTons: 100 }).some(
        (i) => i.code === "tonnage_out_of_range",
      ),
    ).toBe(true);
  });
});

describe("validateStepDeltaRelationship", () => {
  it("warns (not rejects) the spec's own stated defaults, which would otherwise deadlock", () => {
    const issues = validateStepDeltaRelationship({
      minStepDeltaPct: 15,
      modulationStepPct: 10,
      maxStepsPerTick: 1,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("is silent when the relationship is sound", () => {
    expect(
      validateStepDeltaRelationship({
        minStepDeltaPct: 5,
        modulationStepPct: 10,
        maxStepsPerTick: 1,
      }),
    ).toEqual([]);
  });
});

describe("validateSleepModeStepDelta", () => {
  it("warns when the sleep-mode threshold isn't actually wider than normal", () => {
    const issues = validateSleepModeStepDelta({
      minStepDeltaPct: 15,
      sleepModeMinStepDeltaPct: 15,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("is silent when the sleep-mode threshold is wider", () => {
    expect(
      validateSleepModeStepDelta({
        minStepDeltaPct: 15,
        sleepModeMinStepDeltaPct: 30,
      }),
    ).toEqual([]);
  });
});

describe("validatePriorityOrder", () => {
  it("rejects a duplicate zone id", () => {
    const issues = validatePriorityOrder(["a", "a"], new Set(["a"]));
    expect(issues.some((i) => i.code === "priority_order_duplicate")).toBe(
      true,
    );
  });

  it("rejects an id that doesn't resolve to a known zone", () => {
    const issues = validatePriorityOrder(["missing"], new Set(["a"]));
    expect(issues.some((i) => i.code === "priority_order_unknown_zone")).toBe(
      true,
    );
  });

  it("passes a valid, unique list", () => {
    expect(validatePriorityOrder(["a", "b"], new Set(["a", "b"]))).toEqual([]);
  });
});
