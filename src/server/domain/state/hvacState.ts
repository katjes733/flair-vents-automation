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
