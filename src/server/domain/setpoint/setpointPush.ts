import { smoothOffset } from "~/server/domain/setpoint/offsetSmoothing";
import type { HvacCallState } from "~/server/domain/types";

export type SetpointPushMechanism =
  | "offset_correction"
  | "termination_override"
  | "suppressed_tracked_zone_stale";

export interface SetpointPushResult {
  pushedValue: number;
  smoothedOffset: number;
  mechanism: SetpointPushMechanism;
}

/**
 * The two-piece mechanism (see "Driving setpoint selection & the
 * Ecobee/Bosch mechanism"). Piece 1 (accurate tracking, never padded):
 * push = trackedZoneSetpoint + smoothedOffset, where offset measures the
 * real, current gap between whatever Ecobee is comparing against and the
 * true tracked-zone *temperature* — self-correcting regardless of
 * Ecobee's comfort-setting sensor-group configuration. Getting this
 * offset wrong is not a cosmetic bug: using the tracked zone's *setpoint*
 * here instead (as an earlier version of this function did) makes
 * `pushedValue` collapse to ≈`thermostatReading` regardless of the
 * tracked zone's real state — Ecobee would always perceive itself as
 * roughly at target, silently defeating the entire mechanism. Piece 2
 * (prompt termination): once every currently-demanding zone on the
 * handler is satisfied (demandingZoneCount === 0), the pushed value
 * snaps toward thermostatReading ± margin via a max/min guard, in the
 * stop direction only — the property that makes "never manufactures
 * urgency" provable rather than merely intended.
 */
export function computeSetpointPush(params: {
  state: HvacCallState;
  trackedZoneSetpoint: number;
  trackedZoneTemp: number | null;
  trackedZoneStale: boolean;
  thermostatReading: number | null;
  previousSmoothedOffset: number;
  alpha: number;
  maxAbsOffsetC: number;
  demandingZoneCount: number;
  terminationMarginC: number;
}): SetpointPushResult {
  if (
    params.trackedZoneStale ||
    params.thermostatReading === null ||
    params.trackedZoneTemp === null
  ) {
    return {
      pushedValue: params.trackedZoneSetpoint,
      smoothedOffset: 0,
      mechanism: "suppressed_tracked_zone_stale",
    };
  }

  const rawOffset = params.thermostatReading - params.trackedZoneTemp;
  const smoothedOffset = smoothOffset({
    previousSmoothedOffset: params.previousSmoothedOffset,
    rawOffset,
    alpha: params.alpha,
    maxAbsOffsetC: params.maxAbsOffsetC,
  });
  const trackingValue = params.trackedZoneSetpoint + smoothedOffset;

  if (params.demandingZoneCount === 0) {
    const terminationValue =
      params.state === "COOLING_CALL"
        ? params.thermostatReading + params.terminationMarginC
        : params.thermostatReading - params.terminationMarginC;
    const pushedValue =
      params.state === "COOLING_CALL"
        ? Math.max(trackingValue, terminationValue)
        : Math.min(trackingValue, terminationValue);
    return { pushedValue, smoothedOffset, mechanism: "termination_override" };
  }

  return {
    pushedValue: trackingValue,
    smoothedOffset,
    mechanism: "offset_correction",
  };
}
