import type { AbsoluteTemp, TempDelta } from "~/shared/types/temperature";
import type { HvacCallState } from "~/server/domain/types";

export interface AwaySource {
  /** Zones on an air handler whose Ecobee reported Away — inherently per air handler. */
  ecobeeAwayZoneIds: ReadonlySet<string>;
  /** system_settings.config.away_native_zone_ids — arbitrary, flexible. */
  nativeAwayZoneIds: ReadonlySet<string>;
}

/** A zone is away if either source includes it — a union, not either/or. */
export function resolveAwaySource(zoneId: string, source: AwaySource): boolean {
  return (
    source.ecobeeAwayZoneIds.has(zoneId) || source.nativeAwayZoneIds.has(zoneId)
  );
}

export interface AwayTarget {
  setpoint: AbsoluteTemp;
  tolerance: TempDelta;
}

/**
 * Away's setpoint pair, resolved by call state exactly like every other
 * consumer of a cool/heat pair — Away's own value has to offer both or it
 * produces a nonsensical target in whichever mode it wasn't written for.
 * Overrides that zone's normal tolerance for as long as it stays away; the
 * caller is responsible for checking manual overrides first (manual
 * survives Away, per the Target Resolution Order).
 */
export function applyAwayTargets(params: {
  awaySetpointCool: AbsoluteTemp;
  awaySetpointHeat: AbsoluteTemp;
  awayTolerance: TempDelta;
  state: HvacCallState;
}): AwayTarget {
  return {
    setpoint:
      params.state === "COOLING_CALL"
        ? params.awaySetpointCool
        : params.awaySetpointHeat,
    tolerance: params.awayTolerance,
  };
}
