import type { HvacCallState } from "~/server/domain/types";

export type HapTargetHeatingCoolingState = 0 | 1 | 2 | 3; // Off, Heat, Cool, Auto

export type HomeKitSetpointWrite =
  | { kind: "target"; value: number }
  | { kind: "threshold"; which: "heat" | "cool"; value: number }
  | { kind: "skip"; reason: "mode_off" };

/**
 * Decides which HAP Thermostat characteristic to write for a computed
 * pushedValue — and, just as importantly, which one *not* to. This never
 * takes `TargetHeatingCoolingState` as anything but a read-only input:
 * this app must never write the Heat/Cool/Auto/Off mode itself, under any
 * circumstance, not even as a "fix" — confirmed directly, live, this
 * session (Flair's own equivalent mistake — force-asserting a single mode
 * as a side effect of its own setpoint push — is exactly the failure this
 * function exists to avoid repeating).
 *
 * Mode 1/2 (single Heat/Cool, the case this account is actually in today)
 * writes the single TargetTemperature characteristic. Mode 3 (Auto)
 * writes only *one* threshold — whichever side the current call direction
 * (`callState`, the same concept `computeSetpointPush` already uses)
 * actually corresponds to — never both: `pushedValueC` is one computed
 * number for the zone currently driving the call, and there's no
 * principled way to derive the *other* direction's threshold from it, so
 * the other side is left exactly as it already is rather than imposing an
 * invented value (writing both to the same number would also collapse
 * the heat/cool deadband to zero, which no one asked for). Mode 0 (Off)
 * writes nothing — there's no active call for a setpoint to influence.
 */
export function resolveHomeKitSetpointWrite(params: {
  targetMode: HapTargetHeatingCoolingState;
  callState: HvacCallState;
  pushedValueC: number;
}): HomeKitSetpointWrite {
  switch (params.targetMode) {
    case 0:
      return { kind: "skip", reason: "mode_off" };
    case 3:
      return {
        kind: "threshold",
        which: params.callState === "COOLING_CALL" ? "cool" : "heat",
        value: params.pushedValueC,
      };
    default:
      return { kind: "target", value: params.pushedValueC };
  }
}

/**
 * The single number this app trusts as "what the thermostat is actually
 * holding right now" — the read-side counterpart to
 * resolveHomeKitSetpointWrite's write-side decision, and the same
 * precedence tick.ts's own decision-log field already used inline (a real
 * HomeKit read over Flair's relayed value, since Flair's cloud sync can lag
 * a change made directly on the thermostat/Ecobee app — see
 * HomeKitCurrentState's own comment). Extracted here so the exact same
 * logic can also gate whether a termination push still needs to be
 * (re)dispatched: comparing this against a freshly computed pushedValue is
 * a genuine device echo, not an optimistic "the write call didn't throw" —
 * which is what makes an indefinite "redo until confirmed" loop safe
 * without its own separate persisted retry flag.
 */
export function resolveReportedThermostatSetpoint(params: {
  deliveryMode: "flair" | "homekit";
  callState: HvacCallState;
  homeKitState: {
    targetMode: HapTargetHeatingCoolingState;
    targetTemperatureC: number | null;
    heatThresholdC: number | null;
    coolThresholdC: number | null;
  } | null;
  flairTargetTemperatureC: number | null;
}): number | null {
  if (
    params.deliveryMode === "homekit" &&
    params.homeKitState?.targetTemperatureC !== null
  ) {
    return params.homeKitState?.targetTemperatureC ?? null;
  }
  if (
    params.deliveryMode === "homekit" &&
    params.homeKitState?.targetMode === 3 &&
    (params.callState === "COOLING_CALL"
      ? params.homeKitState.coolThresholdC
      : params.homeKitState.heatThresholdC) !== null
  ) {
    return params.callState === "COOLING_CALL"
      ? params.homeKitState.coolThresholdC
      : params.homeKitState.heatThresholdC;
  }
  return params.flairTargetTemperatureC;
}
