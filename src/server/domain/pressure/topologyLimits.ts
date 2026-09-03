import type { AirHandlerConfig } from "~/shared/schemas/airHandlerConfig";

const CFM_PER_TON_BLOWER_RATED = 400;
const CFM_PER_TON_MINIMUM_FLOOR = 300;
const CFM_TO_LPS = 0.4719;

export interface ResolvedTopologyLimits {
  blowerRatedFlowRateLps: number;
  blowerRatedFlowRateIsEstimate: boolean;
  minimumAggregateFlowLps: number;
  minimumAggregateFlowIsEstimate: boolean;
}

/**
 * Resolves the per-air-handler flow-rate bounds the pressure safeguard
 * needs. Real, sourced config values always win; when unset, both derive
 * from the one required universal baseline, tonnage_tons — never from
 * zone count (a discarded earlier formula underestimated real airflow by
 * ~4x) and never from topologyMode (recorded, but no longer the source of
 * any enforced number). See "Domain Research Directive" and "Pressure
 * safeguard" in the implementation plan.
 */
export function resolveTopologyLimits(
  config: Pick<
    AirHandlerConfig,
    | "tonnage_tons"
    | "blower_rated_flow_rate_lps"
    | "blower_rated_flow_rate_is_estimate"
    | "minimum_aggregate_flow_lps"
    | "minimum_aggregate_flow_is_estimate"
  >,
): ResolvedTopologyLimits {
  const tonnage = config.tonnage_tons ?? null;

  const blowerRatedFlowRateLps =
    config.blower_rated_flow_rate_lps ??
    (tonnage !== null ? tonnage * CFM_PER_TON_BLOWER_RATED * CFM_TO_LPS : 0);
  const minimumAggregateFlowLps =
    config.minimum_aggregate_flow_lps ??
    (tonnage !== null ? tonnage * CFM_PER_TON_MINIMUM_FLOOR * CFM_TO_LPS : 0);

  return {
    blowerRatedFlowRateLps,
    blowerRatedFlowRateIsEstimate:
      config.blower_rated_flow_rate_lps === undefined
        ? true
        : config.blower_rated_flow_rate_is_estimate,
    minimumAggregateFlowLps,
    minimumAggregateFlowIsEstimate:
      config.minimum_aggregate_flow_lps === undefined
        ? true
        : config.minimum_aggregate_flow_is_estimate,
  };
}
