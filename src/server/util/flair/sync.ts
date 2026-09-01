import type { VentHardwareType } from "~/shared/schemas/zoneConfig";
import type { SyncCandidateRoom } from "~/server/util/flair/resources";

export interface ExistingZoneSyncInfo {
  zoneId: string;
  name: string;
  flairRoomId: string | null;
  ventHardwareType: VentHardwareType;
  flairVentIds: string[];
  hasTemperatureSensor: boolean;
  hasOccupancySensor: boolean;
}

// One entry per *live* Flair room — see "Flair Sync Engine" in the
// implementation plan for why each kind exists and how it's applied.
// Matched kinds are applied automatically; unmatched kinds wait for an
// explicit user action (link or create).
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
      fromType: VentHardwareType;
      liveVentIds: string[];
    }
  | {
      kind: "matched_hardware_removed";
      zoneId: string;
      flairRoomId: string;
      fromType: VentHardwareType;
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

function sameVentSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

/**
 * Pure diff — no Flair client, no DB, independently testable. Every
 * matched entry recomputes the full live room state (sensor flags + vent
 * ids); `kind` picks which log event/user-facing description applies when
 * more than one thing changed at once, it doesn't limit what gets patched
 * downstream — the applier always writes the complete recomputed state.
 */
export function computeSyncDiff(
  liveRooms: SyncCandidateRoom[],
  existingZones: ExistingZoneSyncInfo[],
): SyncDiffEntry[] {
  const zoneByRoomId = new Map(
    existingZones
      .filter(
        (z): z is ExistingZoneSyncInfo & { flairRoomId: string } =>
          z.flairRoomId !== null,
      )
      .map((z) => [z.flairRoomId, z] as const),
  );
  // Only zones with no room linked yet are candidates for a name-based
  // suggestion — an already-linked zone is never re-suggested elsewhere.
  const unlinkedZoneByLowerName = new Map(
    existingZones
      .filter((z) => z.flairRoomId === null)
      .map((z) => [z.name.toLowerCase(), z] as const),
  );

  return liveRooms.map((room): SyncDiffEntry => {
    const zone = zoneByRoomId.get(room.flairRoomId);

    if (!zone) {
      const suggested = unlinkedZoneByLowerName.get(room.name.toLowerCase());
      return suggested
        ? {
            kind: "unmatched_suggested",
            flairRoomId: room.flairRoomId,
            name: room.name,
            liveVentIds: room.liveVentIds,
            hasTemperatureSensor: room.hasTemperatureSensor,
            hasOccupancySensor: room.hasOccupancySensor,
            suggestedZoneId: suggested.zoneId,
          }
        : {
            kind: "unmatched_new",
            flairRoomId: room.flairRoomId,
            name: room.name,
            liveVentIds: room.liveVentIds,
            hasTemperatureSensor: room.hasTemperatureSensor,
            hasOccupancySensor: room.hasOccupancySensor,
          };
    }

    // Retrofit: this zone had no vent before, and the room now has one —
    // the only case that changes ventHardwareType upward.
    if (
      zone.ventHardwareType !== "flair_smart_vent" &&
      room.liveVentIds.length > 0
    ) {
      return {
        kind: "matched_retrofit",
        zoneId: zone.zoneId,
        flairRoomId: room.flairRoomId,
        fromType: zone.ventHardwareType,
        liveVentIds: room.liveVentIds,
      };
    }
    // Hardware removed: a smart-vent zone's room now has zero vents at
    // all — total loss, not a partial reduction. See matched_vent_set_changed
    // for "still has at least one, but the set changed."
    if (
      zone.ventHardwareType === "flair_smart_vent" &&
      room.liveVentIds.length === 0
    ) {
      return {
        kind: "matched_hardware_removed",
        zoneId: zone.zoneId,
        flairRoomId: room.flairRoomId,
        fromType: zone.ventHardwareType,
      };
    }
    if (!sameVentSet(zone.flairVentIds, room.liveVentIds)) {
      return {
        kind: "matched_vent_set_changed",
        zoneId: zone.zoneId,
        flairRoomId: room.flairRoomId,
        liveVentIds: room.liveVentIds,
      };
    }
    if (
      zone.hasTemperatureSensor !== room.hasTemperatureSensor ||
      zone.hasOccupancySensor !== room.hasOccupancySensor
    ) {
      return {
        kind: "matched_sensor_drift",
        zoneId: zone.zoneId,
        flairRoomId: room.flairRoomId,
        hasTemperatureSensor: room.hasTemperatureSensor,
        hasOccupancySensor: room.hasOccupancySensor,
      };
    }
    return {
      kind: "matched_unchanged",
      zoneId: zone.zoneId,
      flairRoomId: room.flairRoomId,
    };
  });
}
