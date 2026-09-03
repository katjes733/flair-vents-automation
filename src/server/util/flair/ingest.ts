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
  diagnostics: {
    rawTemp: number | null;
    // Multi-sensor selection is dormant code today (one sensor per room in
    // this house) — see "Sensor-selection is a control input" in the
    // plan's Phase 0 section. Retained for the disagreement panel only.
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
 */
export function ingestZoneRoomReading(params: {
  zoneId: string;
  room: FlairRoom | null;
  occupancyReading: FlairRemoteSensorReading | null;
  calibrationOffsetC: TempDelta;
}): ZoneRoomReading {
  const rawTemp = params.room?.currentTemperatureC ?? null;
  const calibratedTemp =
    rawTemp !== null
      ? applyCalibration(asAbsoluteTemp(rawTemp), params.calibrationOffsetC)
      : null;

  return {
    zoneId: params.zoneId,
    calibratedTemp,
    occupiedRaw: params.occupancyReading?.occupied ?? null,
    occupancyReadingCreatedAt: params.occupancyReading?.createdAt ?? null,
    diagnostics: {
      rawTemp,
      sensorValues: rawTemp !== null ? { room: rawTemp } : {},
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
