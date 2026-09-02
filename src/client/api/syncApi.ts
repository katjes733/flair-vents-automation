import { httpClient } from "~/client/api/httpClient";
import type { Zone } from "~/client/api/zonesApi";

// One entry per live Flair room — mirrors the server's SyncDiffEntry
// union in util/flair/sync.ts. See "Flair Sync Engine" in the
// implementation plan.
export type SyncDiffEntry =
  | { kind: "matched_unchanged"; zoneId: string; flairRoomId: string }
  | {
      kind: "matched_sensor_drift";
      zoneId: string;
      flairRoomId: string;
      hasTemperatureSensor: boolean;
      hasOccupancySensor: boolean;
    }
  | {
      kind: "matched_vent_set_changed";
      zoneId: string;
      flairRoomId: string;
      liveVentIds: string[];
    }
  | {
      kind: "matched_retrofit";
      zoneId: string;
      flairRoomId: string;
      fromType: string;
      liveVentIds: string[];
    }
  | {
      kind: "matched_hardware_removed";
      zoneId: string;
      flairRoomId: string;
      fromType: string;
    }
  | {
      kind: "unmatched_suggested";
      flairRoomId: string;
      name: string;
      liveVentIds: string[];
      hasTemperatureSensor: boolean;
      hasOccupancySensor: boolean;
      suggestedZoneId: string;
    }
  | {
      kind: "unmatched_new";
      flairRoomId: string;
      name: string;
      liveVentIds: string[];
      hasTemperatureSensor: boolean;
      hasOccupancySensor: boolean;
    };

export type UnmatchedSyncDiffEntry = Extract<
  SyncDiffEntry,
  { kind: "unmatched_suggested" | "unmatched_new" }
>;

export interface SyncRunResult {
  applied: SyncDiffEntry[];
  unmatched: UnmatchedSyncDiffEntry[];
}

export async function runSync(airHandlerId: string): Promise<SyncRunResult> {
  const { data } = await httpClient.post<SyncRunResult>(
    `/sync/${airHandlerId}/run`,
  );
  return data;
}

export async function linkRoomToZone(
  airHandlerId: string,
  flairRoomId: string,
  zoneId: string,
  // Required by the server only when the room has zero live vents (it
  // then resolves to manual_fixed_vent) — see syncService.ts.
  assumedFixedPosition?: number,
): Promise<Zone> {
  const { data } = await httpClient.post<Zone>(`/sync/${airHandlerId}/link`, {
    flair_room_id: flairRoomId,
    zone_id: zoneId,
    assumed_fixed_position: assumedFixedPosition,
  });
  return data;
}

export async function createZoneFromRoom(
  airHandlerId: string,
  flairRoomId: string,
  name?: string,
  assumedFixedPosition?: number,
): Promise<Zone> {
  const { data } = await httpClient.post<Zone>(`/sync/${airHandlerId}/create`, {
    flair_room_id: flairRoomId,
    name,
    assumed_fixed_position: assumedFixedPosition,
  });
  return data;
}
