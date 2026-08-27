import { describe, it, expect } from "vitest";
import {
  resolveZoneConfig,
  COMFORT_TOLERANCE_MAX_C,
  DUCT_FLOW_RATE_MAX_LPS,
} from "~/shared/schemas/zoneConfig";

describe("resolveZoneConfig", () => {
  it("applies every stated default against an empty config", () => {
    const config = resolveZoneConfig({});
    expect(config.idle_baseline_position).toBe(100);
    expect(config.sensor_calibration_offset).toBe(0);
    expect(config.min_vent_position).toBe(0);
    expect(config.max_vent_position).toBe(100);
    expect(config.thermal_load_flags).toEqual([]);
    expect(config.has_temperature_sensor).toBe(false);
    expect(config.has_occupancy_sensor).toBe(false);
  });

  it("leaves comfort_tolerance unset rather than defaulting it to 0", () => {
    const config = resolveZoneConfig({});
    expect(config.comfort_tolerance).toBeUndefined();
  });

  it("resolves against null the same as against an empty object", () => {
    expect(resolveZoneConfig(null)).toEqual(resolveZoneConfig({}));
  });

  it("rejects a comfort_tolerance above the 10°F sanity bound", () => {
    expect(() =>
      resolveZoneConfig({ comfort_tolerance: COMFORT_TOLERANCE_MAX_C + 0.01 }),
    ).toThrow();
  });

  it("rejects a duct_flow_rate_lps above the ~2000 CFM sanity bound", () => {
    expect(() =>
      resolveZoneConfig({ duct_flow_rate_lps: DUCT_FLOW_RATE_MAX_LPS + 1 }),
    ).toThrow();
  });

  it("accepts both thermal load flags set simultaneously", () => {
    const config = resolveZoneConfig({
      thermal_load_flags: ["high_internal_heat_load", "distant_high_duct_loss"],
    });
    expect(config.thermal_load_flags).toEqual([
      "high_internal_heat_load",
      "distant_high_duct_loss",
    ]);
  });
});
