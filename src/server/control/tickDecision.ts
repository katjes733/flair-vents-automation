import type { ContentionResult } from "~/server/domain/position/step3Contention";

// One entry per zone.config.flair_vents member — genuinely per-vent,
// since every vent in a zone is ganged to the same target but reconciles
// and can degrade independently. See "Multi-Vent Zones" in the
// implementation plan.
export interface VentTickDecision {
  flair_vent_id: string;
  // The vent's own Flair-app nickname — "" when not yet visible in the
  // snapshot or never named. See "Raw IDs Leaking Into the UI".
  name: string;
  commanded_position_pct: number | null;
  reported_position_pct: number | null;
  dispatch_decision: "dispatched" | "suppressed_step_delta";
  degraded: boolean;
  // Hardware-health fields for HardwareDiagnostics — see "Stage 12 —
  // Current-Status Diagnostics". Null on any path with no live Flair
  // snapshot (the fault short-circuit) or a vent not yet visible.
  voltage: number | null;
  current_rssi: number | null;
}

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
  // The zone's own resolved target this tick — the value its current
  // reading is actually being compared against to decide
  // satisfied/demanding. Celsius, always (see "Temperature units");
  // converted to the viewer's display unit only in the client. Null when
  // no real target was resolved (e.g. an unsensored zone, or the
  // emergency fail-safe's short-circuit path, where nothing was compared
  // against anything).
  resolved_setpoint: number | null;
  desired_position_pct: number | null;
  post_contention_position_pct: number | null;
  // Empty for manual_fixed_vent/no_vent zones (nothing to dispatch).
  vents: VentTickDecision[];
  reason: string;
}

export interface AirHandlerTickDecision {
  air_handler_id: string;
  tick_at: string;
  duration_ms: number;
  dry_run: boolean;
  control_disarmed: boolean;
  // Whether the Emergency Fail-Safe (see "Emergency fail-safe") is
  // currently active for this air handler — for EquipmentFaultLog's
  // current-status view. See "Stage 12 — Current-Status Diagnostics".
  equipment_fault_active: boolean;
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
    // Ecobee's own actual, currently-held setpoint — read straight from
    // `thermostat-states.target-temperature-c`, never written by this app.
    // Distinct from `pushed_value` (what this app would push if live) —
    // shown side by side so it's clear which is Flair/Ecobee's own live
    // state and which is this app's own computed value.
    thermostat_current_setpoint: number | null;
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
