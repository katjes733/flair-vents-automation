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
import {
  resolveZoneConfig,
  type VentHardwareType,
  type FlairVentConfig,
} from "~/shared/schemas/zoneConfig";
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
    flairVentIds: zone.config.flair_vents.map((v) => v.flair_vent_id),
    hasTemperatureSensor: zone.config.has_temperature_sensor,
    hasOccupancySensor: zone.config.has_occupancy_sensor,
  };
}

/**
 * Builds the zone's new `flair_vents` from the live id set, preserving each
 * surviving vent's own already-configured duct rating rather than
 * silently wiping it — sync only ever learns a vent's *identity* from
 * Flair, never its rating, so a vent that's still present after a re-sync
 * must keep whatever rating a human already entered for it. A vent id
 * that's new (never seen before) starts unrated, falling back to the
 * standard default exactly like a brand-new vent always has.
 */
function mergeFlairVents(
  existingVents: FlairVentConfig[],
  liveVentIds: string[],
): FlairVentConfig[] {
  const existingById = new Map(
    existingVents.map((v) => [v.flair_vent_id, v] as const),
  );
  return liveVentIds.map((id) => existingById.get(id) ?? { flair_vent_id: id });
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
  existingFlairVents: FlairVentConfig[],
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
        config: {
          flair_vents: mergeFlairVents(existingFlairVents, entry.liveVentIds),
        },
      });
      logZoneVentSetUpdated(syncLog, {
        zone_id: entry.zoneId,
        flair_vent_ids: entry.liveVentIds,
      });
      return;
    case "matched_retrofit":
      await updateZoneWithValidation(entry.zoneId, {
        ventHardwareType: "flair_smart_vent",
        config: {
          flair_vents: mergeFlairVents(existingFlairVents, entry.liveVentIds),
        },
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
        config: { flair_vents: [] },
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
  const zoneById = new Map(zones.map((z) => [z.id, z] as const));
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
        zoneById.get(entry.zoneId)?.config.flair_vents ?? [],
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
 * A brand-new (or newly-linked) Flair room reporting zero live vents
 * defaults to `manual_fixed_vent`, not `no_vent` — per direct confirmation
 * from the house this app runs in: a room configured in the Flair app is
 * essentially never truly vent-less; a room with no *Flair-controlled*
 * vent overwhelmingly has a plain, manually-actuated one instead. This
 * reverses an earlier version of this default (`no_vent`) that assumed
 * "Flair doesn't report a vent" meant "no vent exists" — confirmed wrong
 * for two real rooms (Martin Office, Den back), both of which have an
 * actual manual vent Flair simply doesn't track. `flair_room_id` staying
 * linked either way is what makes this safe: it's what anchors the
 * room's live sensor data, entirely independent of vent hardware — see
 * `validateZoneConfig`'s own updated comment. A room that's genuinely
 * vent-less (a hallway, a sensor puck with no register at all) is still
 * reachable — the "Vent hardware type" selector in `ZoneDetailDialog`
 * lets it be corrected to `no_vent` after import.
 */
function resolveImportedVentHardwareType(
  liveVentIds: string[],
): VentHardwareType {
  return liveVentIds.length > 0 ? "flair_smart_vent" : "manual_fixed_vent";
}

/**
 * Links an unmatched room to an existing (currently unlinked) zone —
 * touches only flairRoomId/ventHardwareType/config, never `name` or
 * anything schedule-related, so the zone's own identity and every
 * schedule/priority-order reference to it survive untouched.
 * `assumedFixedPosition` is required by the caller whenever the room has
 * zero live vents (the resolved type is `manual_fixed_vent`, which
 * validateConfig requires a fixed position for) — never guessed here,
 * since there's no real physical value to infer it from.
 */
export async function linkRoomToZone(params: {
  zoneId: string;
  room: SyncCandidateRoom;
  assumedFixedPosition?: number;
}): Promise<ZoneData> {
  const ventHardwareType = resolveImportedVentHardwareType(
    params.room.liveVentIds,
  );
  return updateZoneWithValidation(params.zoneId, {
    flairRoomId: params.room.flairRoomId,
    ventHardwareType,
    config: {
      flair_vents: params.room.liveVentIds.map((flair_vent_id) => ({
        flair_vent_id,
      })),
      has_temperature_sensor: params.room.hasTemperatureSensor,
      has_occupancy_sensor: params.room.hasOccupancySensor,
      // A real [] (not undefined/null) correctly clears a stale
      // manual_vents set when linking converts an existing
      // manual_fixed_vent zone to flair_smart_vent — manual_vents has its
      // own `.default([])`, so unlike assumed_fixed_position's old
      // no-default optional shape, there's no null-sentinel dance needed
      // here (see zodPartial.ts) even though this call, like that one,
      // goes straight into updateZoneWithValidation's in-process merge
      // with no JSON boundary in between. Sync only ever knows about one
      // physical vent per zero-vent room (it can't infer a real count) —
      // the "Vent hardware type" selector in `ZoneDetailDialog` is where a
      // second/third vent gets added, same as before.
      manual_vents:
        ventHardwareType === "manual_fixed_vent" &&
        params.assumedFixedPosition !== undefined
          ? [{ position: params.assumedFixedPosition }]
          : [],
    },
  });
}

/**
 * Creates a brand new zone from an unmatched room's live data.
 * `assumedFixedPosition` — see `linkRoomToZone`'s own comment; the same
 * requirement applies here for a zero-vent room.
 */
export async function createZoneFromRoom(params: {
  installationId: string;
  airHandlerId: string;
  room: SyncCandidateRoom;
  name?: string;
  assumedFixedPosition?: number;
}): Promise<ZoneData> {
  const ventHardwareType = resolveImportedVentHardwareType(
    params.room.liveVentIds,
  );
  return createZoneForInstallation({
    installationId: params.installationId,
    airHandlerId: params.airHandlerId,
    flairRoomId: params.room.flairRoomId,
    name: params.name?.trim() || params.room.name,
    ventHardwareType,
    config: resolveZoneConfig({
      has_temperature_sensor: params.room.hasTemperatureSensor,
      has_occupancy_sensor: params.room.hasOccupancySensor,
      flair_vents: params.room.liveVentIds.map((flair_vent_id) => ({
        flair_vent_id,
      })),
      ...(ventHardwareType === "manual_fixed_vent" &&
        params.assumedFixedPosition !== undefined && {
          manual_vents: [{ position: params.assumedFixedPosition }],
        }),
    }),
  });
}
