import { describe, it, expect } from "vitest";
import { resolveAirHandlerConfig } from "~/shared/schemas/airHandlerConfig";

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
});
