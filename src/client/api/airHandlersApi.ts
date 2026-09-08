import { httpClient } from "~/client/api/httpClient";

export interface AirHandlerConfig {
  topology_mode: "single_stage" | "two_stage" | "variable_speed";
  pressure_cap_override_pct?: number;
  tonnage_tons?: number;
  blower_rated_flow_rate_lps?: number;
  blower_rated_flow_rate_is_estimate: boolean;
  minimum_aggregate_flow_lps?: number;
  minimum_aggregate_flow_is_estimate: boolean;
  // Undefined means "use the installation-wide System Parameters value" —
  // see away_setpoint_cool/away_setpoint_heat/away_tolerance in
  // systemSettings.ts, whose values these fall back to.
  away_setpoint_cool_override?: number;
  away_setpoint_heat_override?: number;
  away_tolerance_override?: number;
  // Which channel this handler's driving setpoint push is delivered
  // through — see "Direct HomeKit Thermostat Control" in the plan.
  setpoint_delivery_mode: "flair" | "homekit";
}

export interface AirHandler {
  id: string;
  installationId: string;
  flairZoneId: string | null;
  name: string;
  active: boolean;
  config: AirHandlerConfig;
}

export interface CreateAirHandlerRequest {
  flair_zone_id?: string | null;
  name: string;
  active?: boolean;
  config?: Partial<AirHandlerConfig>;
}

export interface UpdateAirHandlerRequest {
  flair_zone_id?: string | null;
  name?: string;
  active?: boolean;
  // The 3 away-override fields widen to `| null` here (unlike the rest of
  // Partial<AirHandlerConfig>) so a caller can explicitly clear one back
  // to "use the global value" — an omitted key leaves the existing stored
  // value untouched (see genuinePartial's own null-vs-omitted contract),
  // so blanking the field in the UI has to send a real `null`, not just
  // drop the key.
  config?: Omit<
    Partial<AirHandlerConfig>,
    | "away_setpoint_cool_override"
    | "away_setpoint_heat_override"
    | "away_tolerance_override"
  > & {
    away_setpoint_cool_override?: number | null;
    away_setpoint_heat_override?: number | null;
    away_tolerance_override?: number | null;
  };
}

export async function createAirHandler(
  body: CreateAirHandlerRequest,
): Promise<AirHandler> {
  const { data } = await httpClient.post<AirHandler>("/air-handlers", body);
  return data;
}

export async function updateAirHandler(
  id: string,
  body: UpdateAirHandlerRequest,
): Promise<AirHandler> {
  const { data } = await httpClient.patch<AirHandler>(
    `/air-handlers/${id}`,
    body,
  );
  return data;
}

export async function deleteAirHandler(id: string): Promise<void> {
  await httpClient.delete(`/air-handlers/${id}`);
}

// One entry per zone.config.flair_vents member. See "Multi-Vent Zones".
export interface VentTickDecisionRecord {
  flair_vent_id: string;
  // The vent's own Flair-app nickname (e.g. "Den Front") — "" when not
  // yet visible in the latest snapshot or never named in Flair.
  name: string;
  commanded_position_pct: number | null;
  reported_position_pct: number | null;
  dispatch_decision: string;
  // How close this vent is to its next real dispatch — the accumulated
  // change since the last real dispatch (step_delta_pct) out of the
  // threshold that triggers one (min_step_delta_pct, wider during an
  // active Sleep Mode window). Null wherever no dispatch decision was made
  // this tick (e.g. the emergency fail-safe path) — distinct from a real 0.
  step_delta_pct: number | null;
  min_step_delta_pct: number | null;
  degraded: boolean;
  // Hardware-health fields — see "Stage 12 — Current-Status Diagnostics".
  // Null on any path with no live Flair snapshot or a not-yet-visible vent.
  voltage: number | null;
  current_rssi: number | null;
}

export interface ZoneTickDecisionRecord {
  zone_id: string;
  name: string;
  vent_hardware_type: string;
  classification: string;
  occupied: boolean;
  spiking: boolean;
  // The zone's own calibrated reading this tick — Celsius, always; convert
  // via toDisplayAbsolute before rendering. Null when no live reading
  // exists this tick (unsensored zone, or the emergency fail-safe's
  // short-circuit path, which fetches no live snapshot at all).
  temp_calibrated: number | null;
  // The zone's own resolved target this tick — Celsius, always (see
  // "Temperature units"); convert via toDisplayAbsolute before rendering.
  // Null when no real target was resolved this tick (unsensored zone, or
  // the emergency fail-safe's short-circuit path).
  resolved_setpoint: number | null;
  desired_position_pct: number | null;
  post_contention_position_pct: number | null;
  vents: VentTickDecisionRecord[];
  reason: string;
}

export interface AirHandlerTickDecision {
  air_handler_id: string;
  tick_at: string;
  duration_ms: number;
  dry_run: boolean;
  control_disarmed: boolean;
  // Whether the Emergency Fail-Safe is currently active for this air
  // handler — see "Stage 12 — Current-Status Diagnostics".
  equipment_fault_active: boolean;
  hvac_state: string;
  call_confidence: "reported" | "unknown";
  // Which system this tick's hvac_state actually came from — see
  // docs/homekit-ecobee-control-research.md §6.
  hvac_state_source: "flair" | "homekit";
  zones: ZoneTickDecisionRecord[];
  contention: unknown;
  pressure: {
    aggregate_open_lps: number;
    aggregate_open_pct: number;
    floor_lps: number;
    cap_pct: number;
    clamped: boolean;
    blower_rated_flow_rate_is_estimate: boolean;
    minimum_aggregate_flow_is_estimate: boolean;
  } | null;
  driving_zone: { zone_id: string | null; reason: string } | null;
  setpoint_push: {
    pushed_value: number | null;
    pushed_value_c: number | null;
    thermostat_reading: number | null;
    // Ecobee's own actual, currently-held setpoint — read-only, never
    // written by this app. Distinct from `pushed_value` (what this app
    // would push if live).
    thermostat_current_setpoint: number | null;
    // Auto mode's real, two-sided hold (both simultaneously in effect) —
    // populated only when a genuine dual-threshold HomeKit read is
    // available. Null otherwise.
    thermostat_heat_threshold: number | null;
    thermostat_cool_threshold: number | null;
    would_write: boolean;
    demanding_zone_count: number;
    // Which channel this tick's push actually went through — see "Direct
    // HomeKit Thermostat Control" in the plan. homekit_* fields are only
    // ever populated when delivery_mode is "homekit"; null otherwise.
    delivery_mode: "flair" | "homekit";
    homekit_paired: boolean | null;
    homekit_write_kind: "target" | "threshold" | "skip" | null;
    homekit_error: string | null;
  } | null;
  narrative: string;
}

export async function fetchAirHandlers(): Promise<AirHandler[]> {
  const { data } = await httpClient.get<AirHandler[]>("/air-handlers");
  return data;
}

// A real Flair zone, by name — not just an id you'd have to already know.
// `assignedAirHandlerId` is set when another air handler already claims
// this zone (`flair_zone_id` is unique, one Flair zone backs one air
// handler at most). See "Flair Zone Picker" in the implementation plan.
export interface FlairZoneOption {
  id: string;
  name: string;
  assignedAirHandlerId: string | null;
  assignedAirHandlerName: string | null;
}

export async function fetchAvailableFlairZones(): Promise<FlairZoneOption[]> {
  const { data } = await httpClient.get<FlairZoneOption[]>(
    "/air-handlers/flair-zones",
  );
  return data;
}

export async function fetchAirHandlerTickDecision(
  airHandlerId: string,
): Promise<AirHandlerTickDecision | null> {
  try {
    const { data } = await httpClient.get<AirHandlerTickDecision>(
      `/air-handlers/${airHandlerId}/tick-decision`,
    );
    return data;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "response" in err &&
      (err as { response?: { status?: number } }).response?.status === 404
    ) {
      return null;
    }
    throw err;
  }
}
