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
export interface ZoneReading {
  zoneId: string;
  calibratedTemp: AbsoluteTemp | null;
  reportedPositionPct: number | null;
  ductTemperatureC: number | null;
  ductReadingCreatedAt: string | null;
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

/**
 * Applies calibration exactly once, at ingestion — the raw value is
 * retained only in `diagnostics` for logging, never passed to a domain
 * function. `room`/`vent`/`ventReading`/`occupancyReading` are all
 * independently nullable (a `no_vent`/`manual_fixed_vent` zone has no vent
 * at all; a brand new room may have no reading yet; a room with no
 * SmartSensor has no occupancy reading at all).
 */
export function ingestZoneReading(params: {
  zoneId: string;
  room: FlairRoom | null;
  vent: FlairVent | null;
  ventReading: FlairVentReading | null;
  occupancyReading: FlairRemoteSensorReading | null;
  calibrationOffsetC: TempDelta;
}): ZoneReading {
  const rawTemp = params.room?.currentTemperatureC ?? null;
  const calibratedTemp =
    rawTemp !== null
      ? applyCalibration(asAbsoluteTemp(rawTemp), params.calibrationOffsetC)
      : null;

  return {
    zoneId: params.zoneId,
    calibratedTemp,
    reportedPositionPct: params.vent?.percentOpen ?? null,
    ductTemperatureC: params.ventReading?.ductTemperatureC ?? null,
    ductReadingCreatedAt: params.ventReading?.createdAt ?? null,
    occupiedRaw: params.occupancyReading?.occupied ?? null,
    occupancyReadingCreatedAt: params.occupancyReading?.createdAt ?? null,
    diagnostics: {
      rawTemp,
      sensorValues: rawTemp !== null ? { room: rawTemp } : {},
    },
  };
}
