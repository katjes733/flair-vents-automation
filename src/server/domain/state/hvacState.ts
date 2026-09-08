import type { HvacState } from "~/server/domain/types";

export type CallConfidence = "reported" | "unknown";

export interface HvacStateResult {
  state: HvacState;
  confidence: CallConfidence;
}

// Flair's confirmed thermostat-states.operating-state values (Phase 0
// discovery, docs/flair-api-schema.md) — "idle" is a distinct value from a
// real call state, per that doc's "last-non-idle-mode" finding.
const RAW_STATE_MAP: Record<string, HvacState> = {
  cool: "COOLING_CALL",
  heat: "HEATING_CALL",
  fan: "FAN_ONLY",
  idle: "IDLE",
};

/**
 * Derives HVAC state purely from Flair/Ecobee's own reported
 * `operating-state` — never inferred from setpoint-vs-ambient deltas, per
 * the spec's explicit prohibition. An unrecognized/missing raw value
 * yields "unknown" confidence; the caller must hold every zone at idle
 * baseline in that case rather than guessing.
 */
export function deriveHvacState(
  rawOperatingState: string | null,
): HvacStateResult {
  const mapped =
    rawOperatingState !== null ? RAW_STATE_MAP[rawOperatingState] : undefined;
  if (mapped === undefined) {
    return { state: "IDLE", confidence: "unknown" };
  }
  return { state: mapped, confidence: "reported" };
}

/**
 * Derives HVAC state from a local HomeKit read instead of Flair's
 * cloud-relayed `operating-state` — see "Real-time HVAC/fan state via
 * HomeKit" (docs/homekit-ecobee-control-research.md §6), written after a
 * real, confirmed incident where Flair reported "idle" continuously for
 * over an hour while the thermostat's own equipment log showed real
 * cool/fan activity the whole time.
 *
 * `CurrentHeatingCoolingState` alone can't distinguish fan-only from idle
 * (HAP's own enum is only Off/Heat/Cool, no fourth "fan" value) — that's
 * exactly what `CurrentFanState`'s "Blowing Air" (2) supplies. Always
 * "reported" confidence: unlike Flair's operating-state, there's no
 * "missing/unrecognized raw value" case here — both inputs are typed,
 * bounded HAP enums the caller only supplies once a real characteristic
 * read has succeeded (see tick.ts's own null-guard before calling this).
 */
export function deriveHvacStateViaHomeKit(
  currentHeatingCoolingState: 0 | 1 | 2,
  currentFanState: 0 | 1 | 2,
): HvacStateResult {
  if (currentHeatingCoolingState === 1) {
    return { state: "HEATING_CALL", confidence: "reported" };
  }
  if (currentHeatingCoolingState === 2) {
    return { state: "COOLING_CALL", confidence: "reported" };
  }
  return {
    state: currentFanState === 2 ? "FAN_ONLY" : "IDLE",
    confidence: "reported",
  };
}
