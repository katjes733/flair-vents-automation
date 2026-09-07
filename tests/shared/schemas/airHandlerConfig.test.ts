import { describe, it, expect } from "vitest";
import {
  resolveAirHandlerConfig,
  airHandlerConfigPartialSchema,
} from "~/shared/schemas/airHandlerConfig";

describe("resolveAirHandlerConfig", () => {
  it("defaults topology_mode to variable_speed", () => {
    expect(resolveAirHandlerConfig({}).topology_mode).toBe("variable_speed");
  });

  it("defaults blower_rated_flow_rate_is_estimate to true", () => {
    expect(resolveAirHandlerConfig({}).blower_rated_flow_rate_is_estimate).toBe(
      true,
    );
  });

  it("leaves pressure_cap_override_pct unset by default", () => {
    expect(
      resolveAirHandlerConfig({}).pressure_cap_override_pct,
    ).toBeUndefined();
  });

  it("rejects an invalid topology_mode", () => {
    expect(() =>
      resolveAirHandlerConfig({ topology_mode: "three_stage" }),
    ).toThrow();
  });

  it("defaults minimum_aggregate_flow_is_estimate to true and leaves the value unset", () => {
    const config = resolveAirHandlerConfig({});
    expect(config.minimum_aggregate_flow_is_estimate).toBe(true);
    expect(config.minimum_aggregate_flow_lps).toBeUndefined();
  });

  it("accepts a real, sourced minimum_aggregate_flow_lps with is_estimate false", () => {
    const config = resolveAirHandlerConfig({
      minimum_aggregate_flow_lps: 708,
      minimum_aggregate_flow_is_estimate: false,
    });
    expect(config.minimum_aggregate_flow_lps).toBe(708);
    expect(config.minimum_aggregate_flow_is_estimate).toBe(false);
  });

  it("leaves tonnage_tons unset by default", () => {
    expect(resolveAirHandlerConfig({}).tonnage_tons).toBeUndefined();
  });

  it("accepts a positive tonnage_tons", () => {
    expect(resolveAirHandlerConfig({ tonnage_tons: 5 }).tonnage_tons).toBe(5);
  });

  it("rejects a non-positive tonnage_tons", () => {
    expect(() => resolveAirHandlerConfig({ tonnage_tons: 0 })).toThrow();
    expect(() => resolveAirHandlerConfig({ tonnage_tons: -2 })).toThrow();
  });

  it("leaves the away-override fields unset by default", () => {
    const config = resolveAirHandlerConfig({});
    expect(config.away_setpoint_cool_override).toBeUndefined();
    expect(config.away_setpoint_heat_override).toBeUndefined();
    expect(config.away_tolerance_override).toBeUndefined();
  });

  it("accepts a real away-override triple", () => {
    const config = resolveAirHandlerConfig({
      away_setpoint_cool_override: 22,
      away_setpoint_heat_override: 18,
      away_tolerance_override: 0.5,
    });
    expect(config.away_setpoint_cool_override).toBe(22);
    expect(config.away_setpoint_heat_override).toBe(18);
    expect(config.away_tolerance_override).toBe(0.5);
  });

  it("rejects a non-positive away_tolerance_override", () => {
    expect(() =>
      resolveAirHandlerConfig({ away_tolerance_override: 0 }),
    ).toThrow();
    expect(() =>
      resolveAirHandlerConfig({ away_tolerance_override: -1 }),
    ).toThrow();
  });
});

// Regression test: `airHandlerConfigSchema.partial()` alone does NOT
// suppress a field's `.default()` — a minimal PATCH (e.g. only
// `{tonnage_tons: 5}`, exactly what EditAirHandlerDialog sends whenever
// none of the away-override fields are touched) would otherwise be
// silently expanded to every default, resetting `topology_mode` back to
// "variable_speed" and both `_is_estimate` flags back to `true` once
// merged onto the existing row — wiping Upstairs's real, researched
// "confirmed, not estimated" flags on every ordinary edit. See
// zoneConfigPartialSchema's identical, already-fixed bug in the sibling
// config schema.
describe("airHandlerConfigPartialSchema", () => {
  it("leaves every omitted field genuinely absent, not defaulted", () => {
    const result = airHandlerConfigPartialSchema.parse({ tonnage_tons: 5 });
    expect(result).toEqual({ tonnage_tons: 5 });
  });

  it("accepts an explicit null on an away-override field (the clear sentinel)", () => {
    const result = airHandlerConfigPartialSchema.parse({
      away_tolerance_override: null,
    });
    expect(result).toHaveProperty("away_tolerance_override", undefined);
  });
});
