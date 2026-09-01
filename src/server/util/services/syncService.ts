import type { FlairClient } from "~/server/util/flair/client";
import { fetchSyncCandidates } from "~/server/util/flair/resources";
import {
  computeSyncDiff,
  type SyncDiffEntry,
  type ExistingZoneSyncInfo,
} from "~/server/util/flair/sync";
import {
  createZoneForInstallation,
  updateZoneWithValidation,
} from "~/server/util/services/zoneService";
import {
  getZonesForAirHandler,
  type ZoneData,
} from "~/server/util/routes/zone";
import { resolveZoneConfig } from "~/shared/schemas/zoneConfig";
import type { AlertingClient } from "~/server/util/alerting";
import {
  logZoneSensorFlagsUpdated,
  logZoneVentSetUpdated,
  logZoneHardwareRetrofitConverted,
  logZoneDegradedHardwareRemoved,
} from "~/server/logEvents";
import type { SyncCandidateRoom } from "~/server/util/flair/resources";

const syncLog = logger.child({ service: "sync" });

function toSyncInfo(zone: ZoneData): ExistingZoneSyncInfo {
  return {
    zoneId: zone.id,
    name: zone.name,
    flairRoomId: zone.flairRoomId,
    ventHardwareType: zone.ventHardwareType,
    flairVentIds: zone.config.flair_vent_ids,
    hasTemperatureSensor: zone.config.has_temperature_sensor,
    hasOccupancySensor: zone.config.has_occupancy_sensor,
  };
}

/**
 * Applies one matched, non-`unchanged` diff entry — the full recomputed
 * room state is always written (sensor flags + vent ids), regardless of
 * which specific thing changed; `entry.kind` only picks the log event and
 * whether `ventHardwareType` also changes. See "Flair Sync Engine".
 */
async function applyMatchedEntry(
  entry: SyncDiffEntry,
  zoneName: string,
  alerting: AlertingClient,
  rateFloorMinutes: number,
  nowMs: number,
): Promise<void> {
  switch (entry.kind) {
    case "matched_sensor_drift":
      await updateZoneWithValidation(entry.zoneId, {
        config: {
          has_temperature_sensor: entry.hasTemperatureSensor,
          has_occupancy_sensor: entry.hasOccupancySensor,
        },
      });
      logZoneSensorFlagsUpdated(syncLog, {
        zone_id: entry.zoneId,
        has_temperature_sensor: entry.hasTemperatureSensor,
        has_occupancy_sensor: entry.hasOccupancySensor,
      });
      return;
    case "matched_vent_set_changed":
      await updateZoneWithValidation(entry.zoneId, {
        config: { flair_vent_ids: entry.liveVentIds },
      });
      logZoneVentSetUpdated(syncLog, {
        zone_id: entry.zoneId,
        flair_vent_ids: entry.liveVentIds,
      });
      return;
    case "matched_retrofit":
      await updateZoneWithValidation(entry.zoneId, {
        ventHardwareType: "flair_smart_vent",
        config: { flair_vent_ids: entry.liveVentIds },
      });
      logZoneHardwareRetrofitConverted(syncLog, {
        zone_id: entry.zoneId,
        from_type: entry.fromType,
        to_type: "flair_smart_vent",
      });
      return;
    case "matched_hardware_removed":
      await updateZoneWithValidation(entry.zoneId, {
        ventHardwareType: "no_vent",
        config: { flair_vent_ids: [] },
      });
      logZoneDegradedHardwareRemoved(syncLog, {
        zone_id: entry.zoneId,
        from_type: entry.fromType,
        to_type: "no_vent",
      });
      await alerting.alertOnce({
        key: `alert:hardwareRemoved:${entry.zoneId}`,
        subject: `${zoneName}: Flair vent removed`,
        text: `Zone "${zoneName}" no longer has any Flair vent linked to its room — it's been converted to no_vent (sensor-only, no position control) until a vent is paired again in the Flair app and this app is re-synced.`,
        rateFloorMinutes,
        nowMs,
      });
      return;
    case "matched_unchanged":
    case "unmatched_suggested":
    case "unmatched_new":
      return;
  }
}

type UnmatchedSyncDiffEntry = Extract<
  SyncDiffEntry,
  { kind: "unmatched_suggested" | "unmatched_new" }
>;

export interface SyncRunResult {
  applied: SyncDiffEntry[];
  unmatched: UnmatchedSyncDiffEntry[];
}

/**
 * Fetches live Flair rooms for this air handler, diffs against its
 * current zones, and applies every matched entry immediately — nothing
 * in `unmatched` is touched until the caller explicitly links or creates.
 * See "Flair Sync Engine".
 */
export async function runSync(params: {
  installationId: string;
  airHandlerId: string;
  structureId: string;
  flairZoneId: string;
  client: FlairClient;
  alerting: AlertingClient;
  rateFloorMinutes: number;
  nowMs: number;
}): Promise<SyncRunResult> {
  const [liveRooms, zones] = await Promise.all([
    fetchSyncCandidates(params.client, params.structureId, params.flairZoneId),
    getZonesForAirHandler(params.airHandlerId),
  ]);
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));
  const diff = computeSyncDiff(liveRooms, zones.map(toSyncInfo));

  const applied: SyncDiffEntry[] = [];
  const unmatched: UnmatchedSyncDiffEntry[] = [];
  for (const entry of diff) {
    if (
      entry.kind === "unmatched_suggested" ||
      entry.kind === "unmatched_new"
    ) {
      unmatched.push(entry);
      continue;
    }
    if (entry.kind !== "matched_unchanged") {
      await applyMatchedEntry(
        entry,
        zoneNameById.get(entry.zoneId) ?? entry.zoneId,
        params.alerting,
        params.rateFloorMinutes,
        params.nowMs,
      );
    }
    applied.push(entry);
  }
  return { applied, unmatched };
}

/**
 * Links an unmatched room to an existing (currently unlinked) zone —
 * touches only flairRoomId/ventHardwareType/config, never `name` or
 * anything schedule-related, so the zone's own identity and every
 * schedule/priority-order reference to it survive untouched.
 */
export async function linkRoomToZone(params: {
  zoneId: string;
  room: SyncCandidateRoom;
}): Promise<ZoneData> {
  return updateZoneWithValidation(params.zoneId, {
    flairRoomId: params.room.flairRoomId,
    ventHardwareType:
      params.room.liveVentIds.length > 0 ? "flair_smart_vent" : "no_vent",
    config: {
      flair_vent_ids: params.room.liveVentIds,
      has_temperature_sensor: params.room.hasTemperatureSensor,
      has_occupancy_sensor: params.room.hasOccupancySensor,
    },
  });
}

/** Creates a brand new zone from an unmatched room's live data. */
export async function createZoneFromRoom(params: {
  installationId: string;
  airHandlerId: string;
  room: SyncCandidateRoom;
  name?: string;
}): Promise<ZoneData> {
  return createZoneForInstallation({
    installationId: params.installationId,
    airHandlerId: params.airHandlerId,
    flairRoomId: params.room.flairRoomId,
    name: params.name?.trim() || params.room.name,
    ventHardwareType:
      params.room.liveVentIds.length > 0 ? "flair_smart_vent" : "no_vent",
    config: resolveZoneConfig({
      has_temperature_sensor: params.room.hasTemperatureSensor,
      has_occupancy_sensor: params.room.hasOccupancySensor,
      flair_vent_ids: params.room.liveVentIds,
    }),
  });
}
