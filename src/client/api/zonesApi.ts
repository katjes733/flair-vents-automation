import { httpClient } from "~/client/api/httpClient";

export type VentHardwareType =
  "flair_smart_vent" | "manual_fixed_vent" | "no_vent";

// Shared between AddZoneDialog (creation) and ZoneDetailDialog (editing —
// a zone's hardware type is changeable after the fact, not fixed at
// creation, per "Zone Hardware & Sensor Type Matrix"'s retrofit-conversion
// path).
export const VENT_HARDWARE_TYPE_LABELS: Record<VentHardwareType, string> = {
  flair_smart_vent: "Flair smart vent",
  manual_fixed_vent: "Manual fixed vent",
  // Deliberately not "No vent (sensor only)" — has_temperature_sensor/
  // has_occupancy_sensor are independent, freely-set config fields for
  // every vent hardware type (see zoneConfigSchema); a no_vent zone may
  // or may not actually have a sensor, so the label shouldn't claim it
  // does.
  no_vent: "No vent",
};

// One physical manual vent — its own fixed position and (optionally) its
// own duct rating. See zoneConfigSchema's own comment on manual_vents.
export interface ManualVent {
  position: number;
  duct_flow_rate_lps?: number;
}

// One physical Flair-controlled smart vent — its own identity and
// (optionally) its own duct rating. See zoneConfigSchema's own comment on
// flair_vents.
export interface FlairVentConfig {
  flair_vent_id: string;
  duct_flow_rate_lps?: number;
}

export interface ZoneConfig {
  has_temperature_sensor: boolean;
  has_occupancy_sensor: boolean;
  // Every physical manual vent in this zone — required to have at least
  // one entry for a manual_fixed_vent zone, empty for every other type.
  // See "Multi-Vent Manual Zones" and zoneConfigSchema's own comment.
  manual_vents: ManualVent[];
  thermal_load_flags: string[];
  idle_baseline_position: number;
  comfort_tolerance?: number;
  sensor_calibration_offset: number;
  min_vent_position: number;
  max_vent_position: number;
  // The zone's Flair vents to actuate — separate from flair_room_id,
  // which anchors room-scoped sensor data only. Every vent is still
  // commanded to the same ganged target position, but each now carries
  // its own optional duct rating rather than one shared zone-level
  // number — see "Multi-Vent Zones" and "Multi-Vent Manual Zones".
  flair_vents: FlairVentConfig[];
  // The zone's user-arranged position within its air handler's dashboard
  // grid — a pure display concern, unrelated to zone_priority_order (the
  // control loop's contention-resolution priority). See "Reorderable
  // Zone Cards" in the implementation plan.
  display_order: number;
}

// Per-vent outcomes — one entry per config.flair_vents member. See
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

/**
 * `MIN` over currently-degraded vents' own `degraded_since` — mirrors the
 * server-side helper of the same name (`shared/types/zone.ts`). `null`
 * when no vent is currently degraded.
 */
export function zoneDegradedSince(state: ZoneRuntimeState): string | null {
  const since = state.vents
    .filter((v) => v.degraded && v.degraded_since !== null)
    .map((v) => v.degraded_since as string);
  if (since.length === 0) return null;
  return since.reduce((min, s) => (s < min ? s : min));
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
