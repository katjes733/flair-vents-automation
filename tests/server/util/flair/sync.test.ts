import { describe, it, expect } from "vitest";
import {
  computeSyncDiff,
  type ExistingZoneSyncInfo,
} from "~/server/util/flair/sync";
import type { SyncCandidateRoom } from "~/server/util/flair/resources";

function room(overrides: Partial<SyncCandidateRoom> = {}): SyncCandidateRoom {
  return {
    flairRoomId: "room-1",
    name: "Bedroom",
    liveVentIds: ["vent-1"],
    hasTemperatureSensor: true,
    hasOccupancySensor: false,
    ...overrides,
  };
}

function zone(
  overrides: Partial<ExistingZoneSyncInfo> = {},
): ExistingZoneSyncInfo {
  return {
    zoneId: "z1",
    name: "Bedroom",
    flairRoomId: "room-1",
    ventHardwareType: "flair_smart_vent",
    flairVentIds: ["vent-1"],
    hasTemperatureSensor: true,
    hasOccupancySensor: false,
    ...overrides,
  };
}

describe("computeSyncDiff", () => {
  it("reports matched_unchanged when nothing about a linked room differs", () => {
    const [entry] = computeSyncDiff([room()], [zone()]);
    expect(entry).toEqual({
      kind: "matched_unchanged",
      zoneId: "z1",
      flairRoomId: "room-1",
    });
  });

  it("reports matched_sensor_drift when a linked room's sensor flags changed", () => {
    const [entry] = computeSyncDiff(
      [room({ hasOccupancySensor: true })],
      [zone({ hasOccupancySensor: false })],
    );
    expect(entry).toMatchObject({
      kind: "matched_sensor_drift",
      hasTemperatureSensor: true,
      hasOccupancySensor: true,
    });
  });

  it("reports matched_vent_set_changed for a partial (still non-empty) vent-set change", () => {
    const [entry] = computeSyncDiff(
      [room({ liveVentIds: ["vent-1", "vent-2"] })],
      [zone({ flairVentIds: ["vent-1"] })],
    );
    expect(entry).toMatchObject({
      kind: "matched_vent_set_changed",
      liveVentIds: ["vent-1", "vent-2"],
    });
  });

  it("reports matched_retrofit when a no_vent zone's room gains a vent", () => {
    const [entry] = computeSyncDiff(
      [room({ liveVentIds: ["vent-1"] })],
      [
        zone({
          ventHardwareType: "no_vent",
          flairVentIds: [],
        }),
      ],
    );
    expect(entry).toMatchObject({
      kind: "matched_retrofit",
      fromType: "no_vent",
      liveVentIds: ["vent-1"],
    });
  });

  it("reports matched_hardware_removed only on TOTAL vent loss, not a partial reduction", () => {
    const [entry] = computeSyncDiff(
      [room({ liveVentIds: [] })],
      [
        zone({
          ventHardwareType: "flair_smart_vent",
          flairVentIds: ["vent-1"],
        }),
      ],
    );
    expect(entry).toMatchObject({
      kind: "matched_hardware_removed",
      fromType: "flair_smart_vent",
    });
  });

  it("reports unmatched_suggested when an unlinked zone shares the room's name (case-insensitive)", () => {
    const [entry] = computeSyncDiff(
      [room({ flairRoomId: "room-2", name: "office" })],
      [zone({ flairRoomId: null, name: "Office" })],
    );
    expect(entry).toMatchObject({
      kind: "unmatched_suggested",
      flairRoomId: "room-2",
      suggestedZoneId: "z1",
    });
  });

  it("reports unmatched_new when no unlinked zone matches the room's name", () => {
    const [entry] = computeSyncDiff(
      [room({ flairRoomId: "room-2", name: "Garage" })],
      [zone({ flairRoomId: null, name: "Office" })],
    );
    expect(entry).toMatchObject({
      kind: "unmatched_new",
      flairRoomId: "room-2",
      name: "Garage",
    });
  });

  it("never suggests a zone that's already linked to a different room", () => {
    const [entry] = computeSyncDiff(
      [room({ flairRoomId: "room-2", name: "Bedroom" })],
      [zone({ flairRoomId: "room-1", name: "Bedroom" })], // already linked elsewhere
    );
    expect(entry.kind).toBe("unmatched_new");
  });
});
