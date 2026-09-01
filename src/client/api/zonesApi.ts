import { httpClient } from "~/client/api/httpClient";

export type VentHardwareType =
  "flair_smart_vent" | "manual_fixed_vent" | "no_vent";

export interface ZoneConfig {
  has_temperature_sensor: boolean;
  has_occupancy_sensor: boolean;
  assumed_fixed_position?: number;
  duct_flow_rate_lps?: number;
  thermal_load_flags: string[];
  idle_baseline_position: number;
  comfort_tolerance?: number;
  sensor_calibration_offset: number;
  min_vent_position: number;
  max_vent_position: number;
  // The zone's Flair vents to actuate — separate from flair_room_id,
  // which anchors room-scoped sensor data only. See "Multi-Vent Zones" in
  // the implementation plan.
  flair_vent_ids: string[];
}

// Per-vent outcomes — one entry per config.flair_vent_ids member. See
// "Multi-Vent Zones".
export interface VentRuntimeState {
  flair_vent_id: string;
  last_reported_position: number | null;
  degraded: boolean;
  degraded_since: string | null;
  reconcile_attempts: number;
}

export interface ZoneRuntimeState {
  last_target_position: number | null;
  last_commanded_at: string | null;
  vents: VentRuntimeState[];
  last_reading_value: number | null;
  last_reading_changed_at: string | null;
  stale: boolean;
  spike_active: boolean;
  spike_since: string | null;
  last_classification: string | null;
  occupied: boolean;
  occupancy_pending_flip_since: string | null;
}

/** A zone is degraded if any of its vents are — see "Multi-Vent Zones". */
export function isZoneDegraded(state: ZoneRuntimeState): boolean {
  return state.vents.some((v) => v.degraded);
}

export interface Zone {
  id: string;
  installationId: string;
  airHandlerId: string;
  flairRoomId: string | null;
  name: string;
  ventHardwareType: VentHardwareType;
  config: ZoneConfig;
  state: ZoneRuntimeState;
}

export interface CreateZoneRequest {
  air_handler_id: string;
  flair_room_id?: string | null;
  name: string;
  vent_hardware_type: VentHardwareType;
  config?: Partial<ZoneConfig>;
}

export interface UpdateZoneRequest {
  air_handler_id?: string;
  name?: string;
  vent_hardware_type?: VentHardwareType;
  config?: Partial<ZoneConfig>;
}

export async function fetchZones(): Promise<Zone[]> {
  const { data } = await httpClient.get<Zone[]>("/zones");
  return data;
}

export async function createZone(body: CreateZoneRequest): Promise<Zone> {
  const { data } = await httpClient.post<Zone>("/zones", body);
  return data;
}

export async function updateZone(
  id: string,
  body: UpdateZoneRequest,
): Promise<Zone> {
  const { data } = await httpClient.patch<Zone>(`/zones/${id}`, body);
  return data;
}

export async function deleteZone(id: string): Promise<void> {
  await httpClient.delete(`/zones/${id}`);
}
