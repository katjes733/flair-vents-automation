import { applyCalibration } from "~/server/domain/sensors/calibration";
import {
  asAbsoluteTemp,
  type AbsoluteTemp,
  type TempDelta,
} from "~/shared/types/temperature";
import type {
  FlairRoom,
  FlairVent,
  FlairVentReading,
  FlairRemoteSensorReading,
} from "~/server/util/flair/client";
import type { HomeKitSensorReading } from "~/server/util/homekit/client";

// The type boundary that makes "every downstream consumer uses the
// calibrated value" a compile-time property: no domain function signature
// accepts `diagnostics.rawTemp`. See "Domain Logic Architecture" in the
// implementation plan.
//
// Split into a room-scoped reading and a per-vent reading (below) rather
// than one flat object, because a zone's comfort temperature/occupancy is
// genuinely room-scoped (read exclusively from FlairRoom, never any vent)
// while position/duct-temperature are genuinely per-vent — a zone can now
// have more than one vent (zone.config.flair_vents). Doing this split
// at the ingestion boundary, not deeper in the control loop, is what
// prevents every downstream consumer from having to guess which vent's
// reading "represents" the zone. See "Multi-Vent Zones".
export interface ZoneRoomReading {
  zoneId: string;
  calibratedTemp: AbsoluteTemp | null;
  // Live, from the room's Ecobee SmartSensor (`remote-sensor-readings
  // .occupied`) — confirmed present via a targeted live check (see
  // docs/flair-api-schema.md). `null` when the room has no remote sensor
  // reading at all (no SmartSensor, or no reading yet) — distinct from a
  // confirmed `false`.
  occupiedRaw: boolean | null;
  occupancyReadingCreatedAt: string | null;
  // Which source this tick's calibratedTemp/occupiedRaw actually came
  // from — "homekit" only once a real HomeKit-sourced value was used for
  // at least one of the two fields; "flair" otherwise (including every
  // zone with no homekit_sensor_serial mapped at all, the overwhelming
  // majority today). See "Ecobee SmartSensor Reading via HomeKit."
  source: "flair" | "homekit";
  diagnostics: {
    rawTemp: number | null;
    // Multi-sensor selection is dormant code today (one sensor per room in
    // this house) — see "Sensor-selection is a control input" in the
    // plan's Phase 0 section. Retained for the disagreement panel only.
    // A "homekit" key is present only when a mapped SmartSensor's own
    // reading was actually available this tick, regardless of which
    // source ultimately won — so a disagreement is visible even on a
    // tick where Flair's value happened to be used.
    sensorValues: Record<string, number>;
  };
}

export interface ZoneVentReading {
  flairVentId: string;
  // The vent's own Flair-app nickname (e.g. "Den Front") — "" when the
  // vent isn't visible in this tick's snapshot yet, or was never named.
  name: string;
  reportedPositionPct: number | null;
  ductTemperatureC: number | null;
  ductReadingCreatedAt: string | null;
  // Hardware-health fields, passed through unmodified for
  // HardwareDiagnostics — see "Stage 12 — Current-Status Diagnostics".
  // Already fetched by FlairClient.fetchVents() on every tick; simply
  // never threaded past this point before now.
  voltage: number | null;
  currentRssi: number | null;
}

/**
 * Applies calibration exactly once, at ingestion — the raw value is
 * retained only in `diagnostics` for logging, never passed to a domain
 * function. `room`/`occupancyReading` are independently nullable (a brand
 * new room may have no reading yet; a room with no SmartSensor has no
 * occupancy reading at all).
 *
 * `homeKitReading`, when supplied (a zone with `config.homekit_sensor_serial`
 * set, on an air handler with `setpoint_delivery_mode === "homekit"`, and
 * that serial actually found in this tick's live HomeKit read), is
 * preferred over Flair's own relayed room reading — the same "prefer
 * HomeKit, fall back to Flair on any read failure or missing mapping"
 * shape already proven for HVAC state and setpoint delivery. Preference
 * is per-field, not all-or-nothing: a HomeKit reading missing just one of
 * temperature/occupancy still falls back to Flair for that one field
 * alone, rather than discarding the whole reading.
 */
export function ingestZoneRoomReading(params: {
  zoneId: string;
  room: FlairRoom | null;
  occupancyReading: FlairRemoteSensorReading | null;
  calibrationOffsetC: TempDelta;
  homeKitReading?: HomeKitSensorReading | null;
}): ZoneRoomReading {
  const homeKitReading = params.homeKitReading ?? null;
  const flairRawTemp = params.room?.currentTemperatureC ?? null;
  const rawTemp = homeKitReading?.tempC ?? flairRawTemp;
  const source: "flair" | "homekit" =
    homeKitReading?.tempC != null ? "homekit" : "flair";
  const calibratedTemp =
    rawTemp !== null
      ? applyCalibration(asAbsoluteTemp(rawTemp), params.calibrationOffsetC)
      : null;

  return {
    zoneId: params.zoneId,
    calibratedTemp,
    source,
    occupiedRaw:
      homeKitReading?.occupied ?? params.occupancyReading?.occupied ?? null,
    occupancyReadingCreatedAt: params.occupancyReading?.createdAt ?? null,
    diagnostics: {
      rawTemp,
      sensorValues: {
        ...(flairRawTemp !== null ? { room: flairRawTemp } : {}),
        ...(homeKitReading?.tempC != null
          ? { homekit: homeKitReading.tempC }
          : {}),
      },
    },
  };
}

/**
 * One call per `flair_vent_id` a zone is configured with. `vent`/
 * `ventReading` are independently nullable (a vent id not yet visible in
 * this tick's Flair snapshot, or one with no reading yet).
 */
export function ingestZoneVentReading(params: {
  flairVentId: string;
  vent: FlairVent | null;
  ventReading: FlairVentReading | null;
}): ZoneVentReading {
  return {
    flairVentId: params.flairVentId,
    name: params.vent?.name ?? "",
    reportedPositionPct: params.vent?.percentOpen ?? null,
    ductTemperatureC: params.ventReading?.ductTemperatureC ?? null,
    ductReadingCreatedAt: params.ventReading?.createdAt ?? null,
    voltage: params.vent?.voltage ?? null,
    currentRssi: params.vent?.currentRssi ?? null,
  };
}
