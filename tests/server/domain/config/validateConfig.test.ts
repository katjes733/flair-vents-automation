import { describe, it, expect } from "vitest";
import {
  validateZoneConfig,
  validateAirHandlerConfig,
  validateStepDeltaRelationship,
  validatePriorityOrder,
} from "~/server/domain/config/validateConfig";

function zoneConfig(overrides = {}) {
  return {
    ventHardwareType: "flair_smart_vent" as const,
    flairRoomId: null,
    assumedFixedPosition: undefined,
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

  it("rejects flair_room_id on a non-smart-vent zone", () => {
    const issues = validateZoneConfig(
      zoneConfig({
        ventHardwareType: "manual_fixed_vent",
        flairRoomId: "room-1",
        assumedFixedPosition: 50,
      }),
    );
    expect(
      issues.some((i) => i.code === "flair_room_requires_smart_vent"),
    ).toBe(true);
  });

  it("requires assumed_fixed_position for manual_fixed_vent", () => {
    const issues = validateZoneConfig(
      zoneConfig({ ventHardwareType: "manual_fixed_vent" }),
    );
    expect(
      issues.some((i) => i.code === "assumed_fixed_position_required"),
    ).toBe(true);
  });

  it("rejects assumed_fixed_position on any other type", () => {
    const issues = validateZoneConfig(zoneConfig({ assumedFixedPosition: 50 }));
    expect(
      issues.some((i) => i.code === "assumed_fixed_position_not_applicable"),
    ).toBe(true);
  });

  it("rejects min exceeding max", () => {
    const issues = validateZoneConfig(
      zoneConfig({ minVentPosition: 60, maxVentPosition: 40 }),
    );
    expect(issues.some((i) => i.code === "min_exceeds_max")).toBe(true);
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
