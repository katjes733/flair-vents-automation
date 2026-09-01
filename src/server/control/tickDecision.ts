import type { ContentionResult } from "~/server/domain/position/step3Contention";

// The exhaustive per-tick record — see "Comprehensive tick decision
// record" in the implementation plan. Complements the granular event
// catalogue (logEvents.ts); this is the "everything, one place" view.
export interface ZoneTickDecision {
  zone_id: string;
  name: string;
  vent_hardware_type: string;
  classification: string;
  occupied: boolean;
  spiking: boolean;
  desired_position_pct: number | null;
  post_contention_position_pct: number | null;
  commanded_position_pct: number | null;
  reported_position_pct: number | null;
  dispatch_decision:
    "dispatched" | "suppressed_step_delta" | "not_applicable_no_vent";
  reason: string;
}

export interface AirHandlerTickDecision {
  air_handler_id: string;
  tick_at: string;
  duration_ms: number;
  dry_run: boolean;
  control_disarmed: boolean;
  hvac_state: string;
  call_confidence: "reported" | "unknown";
  zones: ZoneTickDecision[];
  contention: ContentionResult | null;
  pressure: {
    aggregate_open_lps: number;
    aggregate_open_pct: number;
    floor_lps: number;
    cap_pct: number;
    clamped: boolean;
  } | null;
  driving_zone: {
    zone_id: string | null;
    reason: string;
  } | null;
  setpoint_push: {
    pushed_value: number | null;
    pushed_value_c: number | null;
    thermostat_reading: number | null;
    would_write: boolean;
    demanding_zone_count: number;
  } | null;
  narrative: string;
}

// One entry per air handler, overwritten each tick — not accumulated. See
// "Comprehensive tick decision record"'s dual-exposure design (also logged
// via logControlTickDecision).
const cache = new Map<string, AirHandlerTickDecision>();

export function cacheTickDecision(decision: AirHandlerTickDecision): void {
  cache.set(decision.air_handler_id, decision);
}

export function getCachedTickDecision(
  airHandlerId: string,
): AirHandlerTickDecision | null {
  return cache.get(airHandlerId) ?? null;
}
