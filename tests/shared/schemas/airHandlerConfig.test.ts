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
});
