import type { HomeKitSensorReading } from "~/server/util/homekit/client";

// Mirrors util/flair/sync.ts's own unmatched-suggestion shape and
// algorithm exactly (a case-insensitive exact name match, no fuzzy/
// similarity scoring) — the same "suggest, but require an explicit
// confirm" precedent, applied to HomeKit SmartSensor accessories instead
// of Flair rooms. See "Ecobee SmartSensor Reading via HomeKit."
export type SensorMatchEntry =
  | {
      kind: "already_mapped";
      serial: string;
      name: string;
      tempC: number | null;
      occupied: boolean | null;
      zoneId: string;
      zoneName: string;
    }
  | {
      kind: "unmapped_suggested";
      serial: string;
      name: string;
      tempC: number | null;
      occupied: boolean | null;
      suggestedZoneId: string;
      suggestedZoneName: string;
    }
  | {
      kind: "unmapped_new";
      serial: string;
      name: string;
      tempC: number | null;
      occupied: boolean | null;
    };

export interface SensorMatchZoneInput {
  id: string;
  name: string;
  homekitSensorSerial: string | null;
}

/**
 * Pure — no HomeKit/DB access, just the classification/name-matching
 * logic, so it's directly unit-testable the same way computeSyncDiff is.
 * A zone already mapped to a *different* serial than the one under
 * consideration is still eligible as a name-match suggestion for an
 * unmapped sensor — re-pointing a mismapped zone is a legitimate action a
 * human might take via the matching dialog, not something this function
 * should silently refuse to suggest.
 */
export function computeSensorMatches(
  sensors: HomeKitSensorReading[],
  zones: SensorMatchZoneInput[],
): SensorMatchEntry[] {
  const mappedZoneBySerial = new Map(
    zones
      .filter((z) => z.homekitSensorSerial !== null)
      .map((z) => [z.homekitSensorSerial as string, z] as const),
  );
  const unmappedZoneByLowerName = new Map(
    zones
      .filter((z) => z.homekitSensorSerial === null)
      .map((z) => [z.name.toLowerCase(), z] as const),
  );

  return sensors.map((sensor) => {
    const name = sensor.name ?? "";
    const mapped = mappedZoneBySerial.get(sensor.serial);
    if (mapped) {
      return {
        kind: "already_mapped",
        serial: sensor.serial,
        name,
        tempC: sensor.tempC,
        occupied: sensor.occupied,
        zoneId: mapped.id,
        zoneName: mapped.name,
      };
    }
    const suggested = name
      ? unmappedZoneByLowerName.get(name.toLowerCase())
      : undefined;
    if (suggested) {
      return {
        kind: "unmapped_suggested",
        serial: sensor.serial,
        name,
        tempC: sensor.tempC,
        occupied: sensor.occupied,
        suggestedZoneId: suggested.id,
        suggestedZoneName: suggested.name,
      };
    }
    return {
      kind: "unmapped_new",
      serial: sensor.serial,
      name,
      tempC: sensor.tempC,
      occupied: sensor.occupied,
    };
  });
}
