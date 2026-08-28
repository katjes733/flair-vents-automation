import { describe, it, expect } from "vitest";
import { resolveTopologyLimits } from "~/server/domain/pressure/topologyLimits";

describe("resolveTopologyLimits", () => {
  it("derives both bounds from tonnage_tons when unset, flagged as estimates", () => {
    const result = resolveTopologyLimits({
      tonnage_tons: 5,
      blower_rated_flow_rate_lps: undefined,
      blower_rated_flow_rate_is_estimate: true,
      minimum_aggregate_flow_lps: undefined,
      minimum_aggregate_flow_is_estimate: true,
    });
    expect(result.blowerRatedFlowRateIsEstimate).toBe(true);
    expect(result.minimumAggregateFlowIsEstimate).toBe(true);
    // 5 tons * 300 CFM/ton * 0.4719 ≈ 708 L/s — matches Upstairs's real,
    // independently-sourced floor almost exactly (not a coincidence, per
    // the plan).
    expect(result.minimumAggregateFlowLps).toBeCloseTo(707.85, 0);
    expect(result.blowerRatedFlowRateLps).toBeCloseTo(943.8, 0);
  });

  it("real, sourced overrides always win over the tonnage-derived estimate", () => {
    const result = resolveTopologyLimits({
      tonnage_tons: 5,
      blower_rated_flow_rate_lps: 921,
      blower_rated_flow_rate_is_estimate: false,
      minimum_aggregate_flow_lps: 708,
      minimum_aggregate_flow_is_estimate: false,
    });
    expect(result.blowerRatedFlowRateLps).toBe(921);
    expect(result.blowerRatedFlowRateIsEstimate).toBe(false);
    expect(result.minimumAggregateFlowLps).toBe(708);
    expect(result.minimumAggregateFlowIsEstimate).toBe(false);
  });

  it("degrades to zero (not a crash) with neither tonnage nor an override set", () => {
    const result = resolveTopologyLimits({
      tonnage_tons: undefined,
      blower_rated_flow_rate_lps: undefined,
      blower_rated_flow_rate_is_estimate: true,
      minimum_aggregate_flow_lps: undefined,
      minimum_aggregate_flow_is_estimate: true,
    });
    expect(result.blowerRatedFlowRateLps).toBe(0);
    expect(result.minimumAggregateFlowLps).toBe(0);
  });

  it("mixes a real blower rating with a tonnage-derived floor independently", () => {
    const result = resolveTopologyLimits({
      tonnage_tons: 5,
      blower_rated_flow_rate_lps: 921,
      blower_rated_flow_rate_is_estimate: false,
      minimum_aggregate_flow_lps: undefined,
      minimum_aggregate_flow_is_estimate: true,
    });
    expect(result.blowerRatedFlowRateLps).toBe(921);
    expect(result.blowerRatedFlowRateIsEstimate).toBe(false);
    expect(result.minimumAggregateFlowIsEstimate).toBe(true);
  });
});
