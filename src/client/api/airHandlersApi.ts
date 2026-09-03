import { httpClient } from "~/client/api/httpClient";

export interface AirHandlerConfig {
  topology_mode: "single_stage" | "two_stage" | "variable_speed";
  pressure_cap_override_pct?: number;
  tonnage_tons?: number;
  blower_rated_flow_rate_lps?: number;
  blower_rated_flow_rate_is_estimate: boolean;
  minimum_aggregate_flow_lps?: number;
  minimum_aggregate_flow_is_estimate: boolean;
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
  config?: Partial<AirHandlerConfig>;
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
    would_write: boolean;
    demanding_zone_count: number;
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
