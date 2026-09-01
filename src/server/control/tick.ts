import type { FlairClient } from "~/server/util/flair/client";
import { fetchAirHandlerSnapshot } from "~/server/util/flair/resources";
import { ingestZoneReading } from "~/server/util/flair/ingest";
import { pushSetpoint } from "~/server/util/flair/commands";
import type { AirHandlerData } from "~/server/util/routes/airHandler";
import type { ZoneData } from "~/server/util/routes/zone";
import type { ScheduleData } from "~/server/util/routes/schedule";
import type { ManualOverrideRow } from "~/server/util/routes/manualOverride";
import type { SystemSettingsConfig } from "~/shared/schemas/systemSettings";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";

import { deriveHvacState } from "~/server/domain/state/hvacState";
import {
  detectEquipmentFault,
  buildFailSafeCommands,
  detectDuctAirflowAnomaly,
  type DuctReadingZone,
} from "~/server/domain/state/emergency";
import { classifyStaleness } from "~/server/domain/sensors/staleness";
import {
  evaluateSpike,
  type SpikeHysteresisState,
} from "~/server/domain/sensors/spikeDetection";
import { evaluateOccupancy } from "~/server/domain/sensors/occupancy";
import {
  resolveZoneTargets,
  type GoverningEvent,
} from "~/server/domain/targets/resolveTargets";
import {
  selectActiveEvents,
  resolveGoverningEvent,
  type ScheduleEventCandidate,
} from "~/server/domain/schedule/evaluateSchedules";
import { resolveTopologyLimits } from "~/server/domain/pressure/topologyLimits";
import {
  computeZoneCommands,
  type PipelineZoneInput,
} from "~/server/domain/position/pipeline";
import { clampToZoneRange } from "~/server/domain/position/clamp";
import {
  selectDrivingZone,
  type DrivingZoneCandidate,
} from "~/server/domain/setpoint/drivingZone";
import { computeSetpointPush } from "~/server/domain/setpoint/setpointPush";
import { evaluateReconciliation } from "~/server/domain/dispatch/reconciliation";
import { detectDrift } from "~/server/domain/dispatch/stepDelta";
import {
  isControllable,
  contributesToPressure,
} from "~/server/domain/zone/predicates";

import type { ReconciliationQueue } from "~/server/control/reconciliationQueue";
import type { SpikeBufferStore } from "~/server/control/spikeBuffer";
import type { AirHandlerRuntimeStore } from "~/server/control/airHandlerRuntimeStore";
import type { ZoneDemandTrackingStore } from "~/server/control/zoneDemandTrackingStore";
import type { AlertingClient } from "~/server/util/alerting";
import { detectNoImprovement } from "~/server/domain/state/noImprovement";
import { dispatchZoneCommand } from "~/server/control/dispatcher";
import {
  cacheTickDecision,
  type AirHandlerTickDecision,
  type ZoneTickDecision,
} from "~/server/control/tickDecision";
import {
  logHvacStateTransition,
  logZoneEvaluated,
  logZoneExcluded,
  logContentionResolved,
  logPressureSafeguardEvaluated,
  logDrivingSetpointComputed,
  logZoneTelemetryPolled,
  logThermalSpikeDetected,
  logThermalSpikeDecayed,
  logEmergencyFailSafeTriggered,
  logEmergencyFailSafeCleared,
  logFlairSetpointWriteFailing,
  logDuctAirflowAnomalyDetected,
  logVentReconciled,
  logVentDegraded,
  logControlTickCompleted,
  logControlTickDecision,
  logDriftCheckCompleted,
} from "~/server/logEvents";

export interface TickContext {
  installationId: string;
  structureId: string;
  settings: SystemSettingsConfig;
  schedules: ScheduleData[];
  overridesByZoneId: Map<string, ManualOverrideRow>;
  globalDryRun: boolean;
}

export interface TickDeps {
  client: FlairClient;
  reconciliationQueue: ReconciliationQueue;
  spikeBufferStore: SpikeBufferStore;
  airHandlerRuntimeStore: AirHandlerRuntimeStore;
  zoneDemandTrackingStore: ZoneDemandTrackingStore;
  alerting: AlertingClient;
  persistZoneState: (
    zoneId: string,
    patch: Partial<ZoneData["state"]>,
  ) => Promise<void>;
  now: () => number;
}

const ACTUATION_DELAY_MS = 90 * 1000;

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseIsoOrNull(iso: string | null): number | null {
  return iso ? new Date(iso).getTime() : null;
}

/**
 * Every candidate (schedule, event) pair that actually assigns this zone —
 * cross-schedule tiebreak already lives in evaluateSchedules.ts, so this
 * just needs to hand it a flat candidate list.
 */
function candidatesForZone(
  schedules: ScheduleData[],
  zoneId: string,
): ScheduleEventCandidate[] {
  const candidates: ScheduleEventCandidate[] = [];
  for (const schedule of schedules) {
    for (const event of schedule.events) {
      if (event.zone_settings.some((row) => row.zone_id === zoneId)) {
        candidates.push({ scheduleId: schedule.id, event });
      }
    }
  }
  return candidates;
}

function defaultInactiveForZone(
  schedules: ScheduleData[],
  zoneId: string,
): boolean {
  const memberSchedules = schedules.filter((s) =>
    s.events.some((e) => e.zone_settings.some((row) => row.zone_id === zoneId)),
  );
  return (
    memberSchedules.length > 0 &&
    memberSchedules.every((s) => s.config.default_inactive)
  );
}

/**
 * Orchestrates one air handler's tick — the 16-step sequence from "The
 * Control Loop" in the implementation plan. Every decision is computed in
 * full regardless of dry-run/disarm state; only the final dispatch/write
 * is gated.
 */
export async function runTick(
  airHandler: AirHandlerData,
  zones: ZoneData[],
  ctx: TickContext,
  deps: TickDeps,
): Promise<AirHandlerTickDecision> {
  const startedAtMs = deps.now();
  const log = logger.child({
    service: "control",
    air_handler_id: airHandler.id,
  });
  const dryRun =
    ctx.globalDryRun ||
    !ctx.settings.live_air_handler_ids.includes(airHandler.id);

  const priorRuntime = await deps.airHandlerRuntimeStore.get(airHandler.id);

  if (!airHandler.flairZoneId) {
    const decision = buildMinimalDecision(
      airHandler.id,
      startedAtMs,
      deps.now(),
      dryRun,
      {
        state: "IDLE",
        confidence: "unknown",
      },
    );
    finalize(log, decision);
    return decision;
  }

  const snapshot = await fetchAirHandlerSnapshot(
    deps.client,
    ctx.structureId,
    airHandler.flairZoneId,
  );

  // --- Step 1: ingest ------------------------------------------------
  const readings = new Map(
    zones.map((zone) => {
      const room = zone.flairRoomId
        ? (snapshot.roomsById.get(zone.flairRoomId) ?? null)
        : null;
      const vent = room ? (snapshot.ventsByRoomId.get(room.id) ?? null) : null;
      const ventReading = vent
        ? (snapshot.ventReadingsByVentId.get(vent.id) ?? null)
        : null;
      const occupancyReading = room
        ? (snapshot.occupancyReadingByRoomId.get(room.id) ?? null)
        : null;
      return [
        zone.id,
        {
          reading: ingestZoneReading({
            zoneId: zone.id,
            room,
            vent,
            ventReading,
            occupancyReading,
            calibrationOffsetC: asTempDelta(
              zone.config.sensor_calibration_offset,
            ),
          }),
          ventId: vent?.id ?? null,
        },
      ] as const;
    }),
  );

  // --- Step 3: reconciliation sweep ------------------------------------
  // Reuses the readings just fetched — zero extra Flair API calls, per
  // "Reconciliation & startup reconciliation".
  const dueZoneIds = await deps.reconciliationQueue.dequeueDue(startedAtMs);
  for (const zoneId of dueZoneIds) {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) continue;
    const reportedPosition =
      readings.get(zoneId)?.reading.reportedPositionPct ?? null;
    const outcome = evaluateReconciliation({
      targetPosition: zone.state.last_target_position ?? 0,
      reportedPosition,
      minStepDeltaPct: ctx.settings.min_step_delta_pct,
      attemptsSoFar: zone.state.reconcile_attempts,
      maxAttempts: ctx.settings.reconciliation_retry_count,
      dueForCheck: true,
    });
    if (outcome.status === "reconciled") {
      logVentReconciled(log, {
        air_handler_id: airHandler.id,
        zone_id: zoneId,
        attempt: zone.state.reconcile_attempts,
        reported_pct: reportedPosition ?? 0,
      });
      await deps.persistZoneState(zoneId, {
        reconcile_attempts: 0,
        degraded: false,
        degraded_since: null,
      });
    } else if (outcome.status === "retry") {
      await deps.reconciliationQueue.enqueue(
        zoneId,
        startedAtMs + ACTUATION_DELAY_MS,
      );
      await deps.persistZoneState(zoneId, {
        reconcile_attempts: outcome.attempt,
      });
    } else if (outcome.status === "degraded") {
      logVentDegraded(log, {
        air_handler_id: airHandler.id,
        zone_id: zoneId,
        reconcile_attempts: zone.state.reconcile_attempts,
        last_reported_pct: reportedPosition,
      });
      await deps.persistZoneState(zoneId, {
        degraded: true,
        degraded_since: toIso(startedAtMs),
      });
    }
  }

  // --- Periodic drift-check backstop ------------------------------------
  // Independent of whether a reconciliation is currently pending — a vent
  // that already reconciled successfully can still drift afterward, since
  // it has no true position feedback (confirmed live — see
  // docs/flair-api-schema.md's write-boundary verification). Costs zero
  // extra Flair API calls: reported positions are already in `readings`
  // from Step 1. See "Resolved Design Decisions".
  const ticksSinceDriftCheck = priorRuntime.ticksSinceDriftCheck + 1;
  const driftCheckDue =
    ticksSinceDriftCheck >= ctx.settings.drift_check_interval_ticks;
  const nextTicksSinceDriftCheck = driftCheckDue ? 0 : ticksSinceDriftCheck;
  if (driftCheckDue) {
    let ventsChecked = 0;
    let mismatchesFound = 0;
    for (const zone of zones) {
      if (!isControllable(zone.ventHardwareType)) continue;
      const reportedPosition =
        readings.get(zone.id)?.reading.reportedPositionPct ?? null;
      if (reportedPosition === null) continue;
      if (zone.state.last_target_position === null) continue;
      ventsChecked += 1;
      if (
        detectDrift({
          reportedPosition,
          lastTargetPosition: zone.state.last_target_position,
          minStepDeltaPct: ctx.settings.min_step_delta_pct,
        })
      ) {
        mismatchesFound += 1;
        await deps.reconciliationQueue.enqueue(zone.id, startedAtMs);
      }
    }
    logDriftCheckCompleted(log, {
      air_handler_id: airHandler.id,
      vents_checked: ventsChecked,
      mismatches_found: mismatchesFound,
    });
  }

  // --- Step 4: HVAC state ---------------------------------------------
  const hvac = deriveHvacState(
    snapshot.thermostatState?.operatingState ?? null,
  );
  const callActive =
    hvac.state === "COOLING_CALL" || hvac.state === "HEATING_CALL";

  if (priorRuntime.lastHvacState !== hvac.state) {
    logHvacStateTransition(log, {
      air_handler_id: airHandler.id,
      from: priorRuntime.lastHvacState ?? "unknown",
      to: hvac.state,
      call_source: snapshot.thermostatState?.operatingState ?? "unknown",
      dry_run: dryRun,
    });
  }
  const callStartedAtMs = !callActive
    ? null
    : priorRuntime.lastHvacState === hvac.state
      ? priorRuntime.callStartedAtMs
      : startedAtMs;
  const callDurationMinutes =
    callActive && callStartedAtMs !== null
      ? (startedAtMs - callStartedAtMs) / 60000
      : 0;

  const setpointWriteFailingKey = `alert:setpointWriteFailing:${airHandler.id}`;
  if (snapshot.thermostatState?.writtenFailures) {
    logFlairSetpointWriteFailing(log, {
      air_handler_id: airHandler.id,
      written_failures: snapshot.thermostatState.writtenFailures,
    });
    await deps.alerting.alertOnce({
      key: setpointWriteFailingKey,
      subject: `${airHandler.name}: Flair setpoint writes are failing`,
      text: `Flair reports ${snapshot.thermostatState.writtenFailures} failed setpoint write(s) for air handler "${airHandler.name}" — this is a control-channel problem (re-auth/connectivity), not necessarily an equipment fault.`,
      rateFloorMinutes: ctx.settings.email_rate_floor_minutes,
      nowMs: startedAtMs,
    });
  } else {
    await deps.alerting.clearAlert(setpointWriteFailingKey);
  }

  if (hvac.confidence === "unknown") {
    const decision = await holdAtIdleBaseline({
      airHandler,
      zones,
      readings,
      ctx,
      deps,
      log,
      dryRun,
      startedAtMs,
      hvac,
    });
    await deps.airHandlerRuntimeStore.set(airHandler.id, {
      ...priorRuntime,
      lastHvacState: hvac.state,
      callStartedAtMs,
      ticksSinceDriftCheck: nextTicksSinceDriftCheck,
    });
    finalize(log, decision);
    return decision;
  }

  // --- Step 5: equipment fault -----------------------------------------
  const ductZones: DuctReadingZone[] = zones
    .filter((z) => isControllable(z.ventHardwareType))
    .map((z) => {
      const r = readings.get(z.id)!.reading;
      return {
        zoneId: z.id,
        hasSmartVent: true,
        ductTemperatureC: r.ductTemperatureC,
        ductReadingStale: false,
        roomTemperatureC: r.calibratedTemp ?? Number.NaN,
        demanding: false,
        commandedPositionPct: 0,
      };
    })
    .filter((z) => Number.isFinite(z.roomTemperatureC));

  const faultCheck = callActive
    ? detectEquipmentFault({
        state: hvac.state as "COOLING_CALL" | "HEATING_CALL",
        callDurationMinutes,
        gracePeriodMinutes: ctx.settings.equipment_fault_grace_period_minutes,
        ductDeltaThresholdC:
          ctx.settings.equipment_fault_duct_delta_threshold_c,
        zones: ductZones,
      })
    : { faulted: false, reason: "not in a call state" };

  let faultActive = priorRuntime.equipmentFaultActive ?? false;
  let faultClearDwellSinceMs =
    priorRuntime.equipmentFaultClearDwellSinceMs ?? null;
  const failSafeAlertKey = `alert:failsafe:${airHandler.id}`;
  if (faultCheck.faulted) {
    if (!faultActive) {
      logEmergencyFailSafeTriggered(log, {
        air_handler_id: airHandler.id,
        fault_signal: "duct_temperature_differential",
        duct_delta_c: ctx.settings.equipment_fault_duct_delta_threshold_c,
      });
      await deps.alerting.alertOnce({
        key: failSafeAlertKey,
        subject: `${airHandler.name}: Emergency fail-safe triggered`,
        text: `Every smart vent on air handler "${airHandler.name}" has been forced to 100% open — no vent is showing the expected duct-temperature differential for an active call, which this app treats as a possible equipment fault.`,
        rateFloorMinutes: ctx.settings.email_rate_floor_minutes,
        nowMs: startedAtMs,
      });
    }
    faultActive = true;
    faultClearDwellSinceMs = null;
  } else if (faultActive) {
    const dwellSince = faultClearDwellSinceMs ?? startedAtMs;
    const dwellElapsedMinutes = (startedAtMs - dwellSince) / 60000;
    if (
      dwellElapsedMinutes >= ctx.settings.equipment_fault_clear_dwell_minutes
    ) {
      faultActive = false;
      faultClearDwellSinceMs = null;
      logEmergencyFailSafeCleared(log, {
        air_handler_id: airHandler.id,
        fault_signal: "duct_temperature_differential",
        duct_delta_c: null,
      });
      await deps.alerting.clearAlert(failSafeAlertKey);
    } else {
      faultClearDwellSinceMs = dwellSince;
    }
  }

  if (faultActive) {
    const controllableZoneIds = zones
      .filter((z) => isControllable(z.ventHardwareType))
      .map((z) => z.id);
    const commands = buildFailSafeCommands(controllableZoneIds);
    for (const zone of zones) {
      const target = commands[zone.id];
      if (target === undefined) continue;
      const ventId = readings.get(zone.id)!.ventId;
      if (!ventId) continue;
      // Fail-safe is the one dispatch path where a per-zone write failure
      // must never be allowed to abort the loop — every other zone still
      // needs its unconditional 100% command regardless of one zone's
      // Flair API error (a confirmed real failure mode — see
      // docs/flair-api-schema.md's live write-boundary verification).
      try {
        const { lastDispatchedPosition } = await dispatchZoneCommand({
          log,
          client: deps.client,
          airHandlerId: airHandler.id,
          zoneId: zone.id,
          ventId,
          targetPosition: target,
          lastDispatchedPosition: zone.state.last_target_position,
          reportedPosition: readings.get(zone.id)!.reading.reportedPositionPct,
          minStepDeltaPct: 0, // fail-safe bypasses the step-delta suppressor entirely
          reconciliationQueue: deps.reconciliationQueue,
          nowMs: startedAtMs,
          actuationDelayMs: ACTUATION_DELAY_MS,
          dryRun,
        });
        await deps.persistZoneState(zone.id, {
          last_target_position: target,
          last_commanded_at: dryRun
            ? zone.state.last_commanded_at
            : toIso(startedAtMs),
          last_reported_position: lastDispatchedPosition,
        });
      } catch (err) {
        log.error(
          { zone_id: zone.id, err },
          "Vent dispatch failed during emergency fail-safe — continuing with remaining zones",
        );
      }
    }
    await deps.airHandlerRuntimeStore.set(airHandler.id, {
      ...priorRuntime,
      lastHvacState: hvac.state,
      callStartedAtMs,
      equipmentFaultActive: true,
      equipmentFaultClearDwellSinceMs: faultClearDwellSinceMs,
      ticksSinceDriftCheck: nextTicksSinceDriftCheck,
    });
    const decision = buildFaultDecision(
      airHandler.id,
      startedAtMs,
      deps.now(),
      dryRun,
      hvac,
      zones,
    );
    finalize(log, decision);
    return decision;
  }

  // --- Steps 6-7: staleness + spike, per zone ---------------------------
  const zoneStaleness = new Map<string, boolean>();
  const zoneSpike = new Map<
    string,
    { spiking: boolean; belowThresholdSinceMs: number | null }
  >();
  for (const zone of zones) {
    const reading = readings.get(zone.id)!.reading;
    const priorLastReadingChangedAtMs = parseIsoOrNull(
      zone.state.last_reading_changed_at,
    );
    const readingChanged =
      reading.calibratedTemp !== null &&
      reading.calibratedTemp !== zone.state.last_reading_value;
    const lastReadingChangedAtMs =
      reading.calibratedTemp === null
        ? priorLastReadingChangedAtMs
        : readingChanged || priorLastReadingChangedAtMs === null
          ? startedAtMs
          : priorLastReadingChangedAtMs;

    logZoneTelemetryPolled(log, {
      air_handler_id: airHandler.id,
      zone_id: zone.id,
      reading_changed: readingChanged,
      reading_age_seconds: lastReadingChangedAtMs
        ? Math.round((startedAtMs - lastReadingChangedAtMs) / 1000)
        : 0,
    });

    const staleness = classifyStaleness({
      lastReadingChangedAtMs,
      nowMs: startedAtMs,
      staleThresholdMinutes: ctx.settings.stale_threshold_minutes,
      previousClassification: zone.state.last_classification,
    });
    zoneStaleness.set(zone.id, staleness.stale);

    const staleAlertKey = `alert:staleSensor:${zone.id}`;
    if (staleness.stale) {
      await deps.alerting.alertOnce({
        key: staleAlertKey,
        subject: `${zone.name}: sensor reading is stale`,
        text: `Zone "${zone.name}"'s reading hasn't changed in over ${ctx.settings.stale_threshold_minutes} minute(s) — excluded from position control and resting at its idle baseline until it resumes.`,
        rateFloorMinutes: ctx.settings.email_rate_floor_minutes,
        nowMs: startedAtMs,
      });
    } else {
      await deps.alerting.clearAlert(staleAlertKey);
    }

    const degradedAlertKey = `alert:ventDegraded:${zone.id}`;
    const degradedSinceMs = zone.state.degraded_since
      ? new Date(zone.state.degraded_since).getTime()
      : null;
    if (zone.state.degraded && degradedSinceMs !== null) {
      const degradedMinutes = (startedAtMs - degradedSinceMs) / 60000;
      if (degradedMinutes >= ctx.settings.vent_degraded_alert_minutes) {
        await deps.alerting.alertOnce({
          key: degradedAlertKey,
          subject: `${zone.name}: vent degraded`,
          text: `Zone "${zone.name}"'s vent has failed to reconcile to its commanded position for over ${ctx.settings.vent_degraded_alert_minutes} minute(s) and is excluded from the pressure aggregate in the meantime.`,
          rateFloorMinutes: ctx.settings.email_rate_floor_minutes,
          nowMs: startedAtMs,
        });
      }
    } else {
      await deps.alerting.clearAlert(degradedAlertKey);
    }

    if (reading.calibratedTemp !== null) {
      await deps.spikeBufferStore.append(zone.id, {
        timestampMs: startedAtMs,
        temperatureC: reading.calibratedTemp,
      });
    }
    const window = await deps.spikeBufferStore.getWindow(
      zone.id,
      startedAtMs,
      ctx.settings.spike_window_minutes,
    );
    const previousSpike: SpikeHysteresisState = {
      spiking: zone.state.spike_active,
      belowThresholdSinceMs: parseIsoOrNull(zone.state.spike_since),
    };
    const spikeResult = evaluateSpike({
      readings: window,
      minSamples: ctx.settings.spike_min_samples,
      minSpanMinutes: ctx.settings.spike_min_span_minutes,
      riseThresholdPerMin: ctx.settings.spike_rate_threshold_c_per_min,
      clearThresholdPerMin: ctx.settings.spike_clear_rate_threshold_c_per_min,
      plausibilityCapPerMin: ctx.settings.spike_plausibility_cap_c_per_min,
      previous: previousSpike,
      nowMs: startedAtMs,
      stabilizationMinutes: ctx.settings.spike_stabilization_minutes,
    });
    zoneSpike.set(zone.id, spikeResult);
    if (spikeResult.spiking && !previousSpike.spiking) {
      logThermalSpikeDetected(log, {
        air_handler_id: airHandler.id,
        zone_id: zone.id,
        rate_per_min: spikeResult.ratePerMin,
        threshold: ctx.settings.spike_rate_threshold_c_per_min,
        window_s: ctx.settings.spike_window_minutes * 60,
      });
    } else if (!spikeResult.spiking && previousSpike.spiking) {
      logThermalSpikeDecayed(log, {
        air_handler_id: airHandler.id,
        zone_id: zone.id,
        rate_per_min: spikeResult.ratePerMin,
        threshold: ctx.settings.spike_clear_rate_threshold_c_per_min,
        window_s: ctx.settings.spike_window_minutes * 60,
      });
    }
  }

  // --- Step 8: target resolution -----------------------------------------
  const ecobeeAway = snapshot.thermostatState?.homeAway === "Away";
  const awaySource = {
    ecobeeAwayZoneIds: ecobeeAway
      ? new Set(zones.map((z) => z.id))
      : new Set<string>(),
    nativeAwayZoneIds: new Set(ctx.settings.away_native_zone_ids),
  };
  const awayTargets = {
    setpoint: asAbsoluteTemp(
      hvac.state === "COOLING_CALL"
        ? ctx.settings.away_setpoint_cool
        : ctx.settings.away_setpoint_heat,
    ),
    tolerance: asTempDelta(ctx.settings.away_tolerance),
  };
  const fallback = {
    setpoint: asAbsoluteTemp(
      hvac.state === "COOLING_CALL"
        ? ctx.settings.fallback_setpoint_cool
        : ctx.settings.fallback_setpoint_heat,
    ),
    tolerance: null,
  };

  const governingEventByZone = new Map<string, ScheduleEventCandidate | null>();
  for (const zone of zones) {
    const candidates = candidatesForZone(ctx.schedules, zone.id);
    const active = selectActiveEvents(
      candidates,
      startedAtMs,
      ctx.settings.home_timezone,
    );
    governingEventByZone.set(zone.id, resolveGoverningEvent(active));
  }

  const targetsByZone = new Map<
    string,
    ReturnType<typeof resolveZoneTargets>
  >();
  for (const zone of zones) {
    const governingCandidate = governingEventByZone.get(zone.id) ?? null;
    let governingEvent: GoverningEvent | null = null;
    if (governingCandidate) {
      const row = governingCandidate.event.zone_settings.find(
        (r) => r.zone_id === zone.id,
      );
      governingEvent = {
        mode: governingCandidate.event.mode,
        coolSetpoint:
          row?.cool_setpoint !== undefined
            ? asAbsoluteTemp(row.cool_setpoint)
            : null,
        heatSetpoint:
          row?.heat_setpoint !== undefined
            ? asAbsoluteTemp(row.heat_setpoint)
            : null,
        toleranceOverride:
          row?.comfort_tolerance !== undefined
            ? asTempDelta(row.comfort_tolerance)
            : null,
      };
    }
    const override = ctx.overridesByZoneId.get(zone.id) ?? null;
    const target = resolveZoneTargets({
      zoneId: zone.id,
      nowMs: startedAtMs,
      manualOverride: override
        ? {
            config: override.config,
            expiresAtMs: override.expiresAtMs,
            revokedAtMs: override.revokedAtMs,
          }
        : null,
      awaySource,
      awayTargets,
      governingEvent,
      defaultInactive: defaultInactiveForZone(ctx.schedules, zone.id),
      fallback,
      zoneTolerance:
        zone.config.comfort_tolerance !== undefined
          ? asTempDelta(zone.config.comfort_tolerance)
          : null,
      state: hvac.state as "COOLING_CALL" | "HEATING_CALL",
    });
    targetsByZone.set(zone.id, target);
  }

  // --- Occupancy: live sensor signal (debounced) unioned with Sleep Mode --
  // The live signal comes from the room's Ecobee SmartSensor
  // (`remote-sensor-readings.occupied`, confirmed present via a targeted
  // live check — see docs/flair-api-schema.md) — but a sleeping, motionless
  // person still reads as unoccupied on this same PIR-derived signal, which
  // is exactly why Sleep Mode exists as a schedule-time override on top of
  // it, not instead of it. See "Occupancy" in the implementation plan.
  const occupiedByZone = new Map<string, boolean>();
  const occupancyHysteresisByZone = new Map<
    string,
    { occupied: boolean; pendingFlipSince: number | null }
  >();
  // Keyed off the raw per-event flag specifically, not the unioned
  // `occupied` state below — a zone that's only occupied via the live
  // daytime signal isn't sleep-noise-sensitive the same way a room whose
  // schedule explicitly says "someone is sleeping here" is.
  const sleepModeActiveByZone = new Map<string, boolean>();
  for (const zone of zones) {
    const reading = readings.get(zone.id)!.reading;
    const hysteresis = evaluateOccupancy({
      hasOccupancySensor: zone.config.has_occupancy_sensor,
      rawOccupied: reading.occupiedRaw,
      stale: zoneStaleness.get(zone.id) ?? false,
      previous: {
        occupied: zone.state.occupied,
        pendingFlipSince: parseIsoOrNull(
          zone.state.occupancy_pending_flip_since,
        ),
      },
      nowMs: startedAtMs,
      stabilizationMinutes: ctx.settings.occupancy_stabilization_minutes,
    });
    occupancyHysteresisByZone.set(zone.id, hysteresis);

    const governingCandidate = governingEventByZone.get(zone.id);
    const row = governingCandidate?.event.zone_settings.find(
      (r) => r.zone_id === zone.id,
    );
    const assumeOccupied = row?.assume_occupied ?? false;
    occupiedByZone.set(zone.id, hysteresis.occupied || assumeOccupied);
    sleepModeActiveByZone.set(zone.id, assumeOccupied);
  }

  // --- Step 9: the position pipeline --------------------------------------
  const topologyLimits = resolveTopologyLimits(airHandler.config);
  const capLps =
    ((airHandler.config.pressure_cap_override_pct ?? 100) / 100) *
    topologyLimits.blowerRatedFlowRateLps;
  const floorLps = topologyLimits.minimumAggregateFlowLps;

  const pipelineInputs: PipelineZoneInput[] = zones.map((zone) => {
    const reading = readings.get(zone.id)!.reading;
    const target = targetsByZone.get(zone.id)!;
    const priorityList =
      governingEventByZone.get(zone.id)?.event.zone_priority_order ??
      ctx.settings.zone_priority_order;
    const priorityRank = priorityList.indexOf(zone.id);
    return {
      zoneId: zone.id,
      ventHardwareType: zone.ventHardwareType,
      hasTemperatureSensor: zone.config.has_temperature_sensor,
      minVentPosition: zone.config.min_vent_position,
      maxVentPosition: zone.config.max_vent_position,
      idleBaselinePosition: zone.config.idle_baseline_position,
      thermalLoadFlags: zone.config.thermal_load_flags,
      flowRateLps:
        zone.config.duct_flow_rate_lps ??
        ctx.settings.default_zone_flow_rate_lps,
      assumedFixedPosition: zone.config.assumed_fixed_position ?? null,
      calibratedTemp: reading.calibratedTemp ?? asAbsoluteTemp(0),
      resolvedSetpoint: target.setpoint,
      tolerance: target.tolerance,
      occupied: occupiedByZone.get(zone.id) ?? false,
      staleOccupancy: false,
      staleReading: zoneStaleness.get(zone.id) ?? false,
      spiking: zoneSpike.get(zone.id)?.spiking ?? false,
      priorityRank: priorityRank === -1 ? Infinity : priorityRank,
      lastCommandedTarget: zone.state.last_target_position,
      manualPositionPct: target.manualPositionPct,
      degraded: zone.state.degraded,
    };
  });

  const pipelineResult = computeZoneCommands({
    state: hvac.state,
    zones: pipelineInputs,
    settings: {
      proportionalBandWidthC: asTempDelta(ctx.settings.proportional_band_width),
      maxPositionPct: ctx.settings.max_position_pct,
      modifierBoosts: {
        occupancy: ctx.settings.modifier_boosts.occupancy,
        spike: ctx.settings.modifier_boosts.spike,
        highInternalHeatLoad:
          ctx.settings.modifier_boosts.high_internal_heat_load,
        distantHighDuctLoss:
          ctx.settings.modifier_boosts.distant_high_duct_loss,
      },
      heatingChokePositionPct: ctx.settings.heating_choke_position_pct,
      unoccupiedIdleFactor: ctx.settings.unoccupied_idle_factor,
      modulationStepPct: ctx.settings.modulation_step_pct,
      maxStepsPerTick: ctx.settings.max_steps_per_tick,
    },
    capLps,
    floorLps,
  });

  if (pipelineResult.contention) {
    logContentionResolved(log, {
      air_handler_id: airHandler.id,
      candidates: [],
      reductions: pipelineResult.contention.reductions,
      insufficient: pipelineResult.contention.insufficient,
      dry_run: dryRun,
    });
  }
  const pressureFloorAlertKey = `alert:pressureFloorUnsatisfiable:${airHandler.id}`;
  if (pipelineResult.contention?.insufficient) {
    await deps.alerting.alertOnce({
      key: pressureFloorAlertKey,
      subject: `${airHandler.name}: pressure floor unsatisfiable`,
      text: `Even with every zone at its floor, air handler "${airHandler.name}" cannot reach the topology's minimum open-area safeguard — likely a misconfiguration (min_vent_position/idle_baseline_position set too low across too many zones for this equipment).`,
      rateFloorMinutes: ctx.settings.email_rate_floor_minutes,
      nowMs: startedAtMs,
    });
  } else {
    await deps.alerting.clearAlert(pressureFloorAlertKey);
  }

  const aggregateOpenLps = pipelineInputs
    .filter((z) => contributesToPressure(z.ventHardwareType))
    .reduce((sum, z) => {
      const pos = pipelineResult.commandedPositions[z.zoneId] ?? 0;
      return z.degraded ? sum : sum + (pos / 100) * z.flowRateLps;
    }, 0);
  logPressureSafeguardEvaluated(log, {
    air_handler_id: airHandler.id,
    aggregate_open_lps: aggregateOpenLps,
    aggregate_open_pct:
      topologyLimits.blowerRatedFlowRateLps > 0
        ? (aggregateOpenLps / topologyLimits.blowerRatedFlowRateLps) * 100
        : 0,
    floor_lps: floorLps,
    cap_pct: airHandler.config.pressure_cap_override_pct ?? 100,
    clamped: pipelineResult.pressureFloorClamped,
    blower_rated_flow_rate_is_estimate:
      topologyLimits.blowerRatedFlowRateIsEstimate,
    minimum_aggregate_flow_is_estimate:
      topologyLimits.minimumAggregateFlowIsEstimate,
    dry_run: dryRun,
  });

  for (const zone of zones) {
    const reading = readings.get(zone.id)!.reading;
    const classification = pipelineResult.classifications[zone.id];
    if (classification === "satisfied" || classification === "inactive") {
      logZoneExcluded(log, {
        air_handler_id: airHandler.id,
        zone_id: zone.id,
        reason: classification === "inactive" ? "inactive" : "tolerance",
        dry_run: dryRun,
      });
    } else if (zoneStaleness.get(zone.id)) {
      logZoneExcluded(log, {
        air_handler_id: airHandler.id,
        zone_id: zone.id,
        reason: "stale",
        dry_run: dryRun,
      });
    } else {
      logZoneEvaluated(log, {
        air_handler_id: airHandler.id,
        zone_id: zone.id,
        temp_raw: reading.diagnostics.rawTemp,
        temp_calibrated: reading.calibratedTemp,
        setpoint: targetsByZone.get(zone.id)?.setpoint ?? null,
        tolerance: targetsByZone.get(zone.id)?.tolerance ?? null,
        deviation: null,
        desired_position_pct:
          pipelineResult.commandedPositions[zone.id] ?? null,
        satisfied: false,
        dry_run: dryRun,
      });
    }
  }

  // --- Duct airflow anomaly (isolated per-zone) ---------------------------
  if (callActive) {
    const anomalyZones: DuctReadingZone[] = zones
      .filter((z) => isControllable(z.ventHardwareType))
      .map((z) => {
        const r = readings.get(z.id)!.reading;
        return {
          zoneId: z.id,
          hasSmartVent: true,
          ductTemperatureC: r.ductTemperatureC,
          ductReadingStale: false,
          roomTemperatureC: r.calibratedTemp ?? Number.NaN,
          demanding: pipelineResult.classifications[z.id] === "demanding",
          commandedPositionPct: pipelineResult.commandedPositions[z.id] ?? 0,
        };
      })
      .filter((z) => Number.isFinite(z.roomTemperatureC));
    const anomalies = detectDuctAirflowAnomaly({
      state: hvac.state as "COOLING_CALL" | "HEATING_CALL",
      ductDeltaThresholdC: ctx.settings.equipment_fault_duct_delta_threshold_c,
      zones: anomalyZones,
    });
    for (const a of anomalies) {
      const anomalyAlertKey = `alert:ductAnomaly:${a.zoneId}`;
      const demandTracking = await deps.zoneDemandTrackingStore.get(a.zoneId);
      if (a.anomalous) {
        logDuctAirflowAnomalyDetected(log, {
          air_handler_id: airHandler.id,
          zone_id: a.zoneId,
          duct_delta_c: null,
          commanded_position_pct:
            pipelineResult.commandedPositions[a.zoneId] ?? 0,
        });
        const since = demandTracking.ductAnomalySinceMs ?? startedAtMs;
        const anomalyMinutes = (startedAtMs - since) / 60000;
        await deps.zoneDemandTrackingStore.set(a.zoneId, {
          ...demandTracking,
          ductAnomalySinceMs: since,
        });
        if (anomalyMinutes >= ctx.settings.duct_anomaly_alert_minutes) {
          const zoneName =
            zones.find((z) => z.id === a.zoneId)?.name ?? a.zoneId;
          await deps.alerting.alertOnce({
            key: anomalyAlertKey,
            subject: `${zoneName}: isolated duct airflow anomaly`,
            text: `Zone "${zoneName}"'s duct hasn't shown the expected temperature differential for over ${ctx.settings.duct_anomaly_alert_minutes} minute(s), while at least one sibling vent on the same air handler does — possibly a blocked or disconnected duct run.`,
            rateFloorMinutes: ctx.settings.email_rate_floor_minutes,
            nowMs: startedAtMs,
          });
        }
      } else {
        await deps.zoneDemandTrackingStore.set(a.zoneId, {
          ...demandTracking,
          ductAnomalySinceMs: null,
        });
        await deps.alerting.clearAlert(anomalyAlertKey);
      }
    }
  }

  // --- Step 10: driving zone + setpoint push ------------------------------
  const drivingCandidates: DrivingZoneCandidate[] = zones
    .filter((z) => z.config.has_temperature_sensor)
    .map((z) => {
      const reading = readings.get(z.id)!.reading;
      const target = targetsByZone.get(z.id)!;
      const deviation =
        reading.calibratedTemp !== null && target.setpoint !== null
          ? hvac.state === "COOLING_CALL"
            ? reading.calibratedTemp - target.setpoint
            : target.setpoint - reading.calibratedTemp
          : -Infinity;
      return {
        zoneId: z.id,
        hasTemperatureSensor: true,
        stale: zoneStaleness.get(z.id) ?? false,
        demanding: pipelineResult.classifications[z.id] === "demanding",
        deviation,
        priorityRank: ctx.settings.zone_priority_order.indexOf(z.id),
        occupied: occupiedByZone.get(z.id) ?? false,
      };
    })
    .map((c) => ({
      ...c,
      priorityRank: c.priorityRank === -1 ? Infinity : c.priorityRank,
    }));

  // --- Zone demand with no improvement -------------------------------
  // The zone-scoped sibling of "HVAC extended call with no improvement" —
  // added after live hardware verification confirmed a vent can silently
  // under-actuate in a way neither reconciliation nor the whole-system
  // alert can catch. "Near its ceiling" uses a small margin, not exact
  // equality, since a demanding zone can hover a step or two below its
  // configured max without ever landing exactly on it.
  const ZONE_CEILING_MARGIN_PCT = 5;
  for (const candidate of drivingCandidates) {
    const zone = zones.find((z) => z.id === candidate.zoneId)!;
    const commandedPct = pipelineResult.commandedPositions[zone.id] ?? 0;
    const nearCeiling =
      commandedPct >= zone.config.max_vent_position - ZONE_CEILING_MARGIN_PCT;
    const demandTracking = await deps.zoneDemandTrackingStore.get(zone.id);
    const zoneAlertKey = `alert:zoneNoImprovement:${zone.id}`;

    if (
      candidate.demanding &&
      nearCeiling &&
      Number.isFinite(candidate.deviation)
    ) {
      const demandStartedAtMs = demandTracking.demandStartedAtMs ?? startedAtMs;
      const worstDeviationAtDemandStart =
        demandTracking.worstDeviationAtDemandStart ?? candidate.deviation;
      await deps.zoneDemandTrackingStore.set(zone.id, {
        ...demandTracking,
        demandStartedAtMs,
        worstDeviationAtDemandStart,
      });
      const demandDurationMinutes = (startedAtMs - demandStartedAtMs) / 60000;
      if (
        detectNoImprovement({
          worstDeviationAtStart: worstDeviationAtDemandStart,
          currentWorstDeviation: candidate.deviation,
          durationMinutes: demandDurationMinutes,
          alertMinutes: ctx.settings.zone_no_improvement_alert_minutes,
        })
      ) {
        await deps.alerting.alertOnce({
          key: zoneAlertKey,
          subject: `${zone.name}: demand with no improvement`,
          text: `Zone "${zone.name}" has been commanded near its ceiling (${commandedPct}%) for over ${ctx.settings.zone_no_improvement_alert_minutes} minute(s) with no measurable improvement (deviation ${candidate.deviation.toFixed(2)}°C, vs ${worstDeviationAtDemandStart.toFixed(2)}°C when this began).`,
          rateFloorMinutes: ctx.settings.email_rate_floor_minutes,
          nowMs: startedAtMs,
        });
      }
    } else {
      await deps.zoneDemandTrackingStore.set(zone.id, {
        ...demandTracking,
        demandStartedAtMs: null,
        worstDeviationAtDemandStart: null,
      });
      await deps.alerting.clearAlert(zoneAlertKey);
    }
  }

  const explicitOverrideZoneId =
    ctx.settings.driving_zone_overrides[airHandler.id] ?? null;
  const drivingSelection = selectDrivingZone({
    candidates: drivingCandidates,
    explicitOverrideZoneId,
    currentlyTracked: priorRuntime.trackedDrivingZoneId,
    ticksSinceLeadChanged: priorRuntime.ticksSinceLeadChanged,
    switchMarginC: ctx.settings.drive_zone_switch_margin_c,
    switchDwellTicks: ctx.settings.drive_zone_switch_dwell_ticks,
  });
  const ticksSinceLeadChanged =
    drivingSelection.zoneId === priorRuntime.trackedDrivingZoneId
      ? priorRuntime.ticksSinceLeadChanged + 1
      : 0;

  const demandingZoneCount = zones.filter(
    (z) => pipelineResult.classifications[z.id] === "demanding",
  ).length;

  // "HVAC extended call with no improvement" — snapshot-vs-now (see
  // domain/state/noImprovement.ts). The snapshot resets exactly when
  // callStartedAtMs does (Step 4), so a new call always gets a fresh
  // baseline rather than inheriting a stale one from a prior call.
  const currentWorstDeviationC = Math.max(
    0,
    ...drivingCandidates.filter((c) => c.demanding).map((c) => c.deviation),
  );
  const worstDeviationAtCallStartC = !callActive
    ? null
    : priorRuntime.lastHvacState === hvac.state
      ? (priorRuntime.worstDeviationAtCallStartC ?? currentWorstDeviationC)
      : currentWorstDeviationC;
  const hvacNoImprovementKey = `alert:hvacNoImprovement:${airHandler.id}`;
  if (
    detectNoImprovement({
      worstDeviationAtStart: worstDeviationAtCallStartC,
      currentWorstDeviation: currentWorstDeviationC,
      durationMinutes: callDurationMinutes,
      alertMinutes: ctx.settings.hvac_no_improvement_alert_minutes,
    })
  ) {
    await deps.alerting.alertOnce({
      key: hvacNoImprovementKey,
      subject: `${airHandler.name}: HVAC call running with no improvement`,
      text: `The ${hvac.state} call on air handler "${airHandler.name}" has run for ${Math.round(callDurationMinutes)} minute(s) with no zone measurably closer to target (worst deviation ${currentWorstDeviationC.toFixed(2)}°C, vs ${(worstDeviationAtCallStartC ?? 0).toFixed(2)}°C at call start).`,
      rateFloorMinutes: ctx.settings.email_rate_floor_minutes,
      nowMs: startedAtMs,
    });
  } else {
    await deps.alerting.clearAlert(hvacNoImprovementKey);
  }

  let pushedValue: number | null = priorRuntime.lastPushedSetpointC;
  let smoothedOffsetC = priorRuntime.smoothedOffsetC;
  let wouldWrite = false;
  let selectionReason = drivingSelection.reason;

  if (drivingSelection.zoneId) {
    const trackedZone = zones.find((z) => z.id === drivingSelection.zoneId)!;
    const trackedTarget = targetsByZone.get(trackedZone.id)!;
    const pushResult = computeSetpointPush({
      state: hvac.state as "COOLING_CALL" | "HEATING_CALL",
      trackedZoneSetpoint: trackedTarget.setpoint ?? 0,
      trackedZoneTemp: readings.get(trackedZone.id)!.reading.calibratedTemp,
      trackedZoneStale: zoneStaleness.get(trackedZone.id) ?? false,
      thermostatReading: snapshot.thermostatState?.ambientTemperatureC ?? null,
      previousSmoothedOffset: priorRuntime.smoothedOffsetC,
      alpha: ctx.settings.offset_smoothing_alpha,
      maxAbsOffsetC: ctx.settings.offset_max_c,
      demandingZoneCount,
      terminationMarginC: ctx.settings.termination_margin_c,
    });
    pushedValue = pushResult.pushedValue;
    smoothedOffsetC = pushResult.smoothedOffset;
    wouldWrite = true;
  } else {
    selectionReason = "none_eligible";
  }

  const controlDisarmed = ctx.settings.control_disarmed;

  logDrivingSetpointComputed(log, {
    air_handler_id: airHandler.id,
    driving_zone_id: drivingSelection.zoneId,
    selection_reason: selectionReason,
    pushed_value: pushedValue,
    pushed_value_c: pushedValue,
    thermostat_reading: snapshot.thermostatState?.ambientTemperatureC ?? null,
    would_write: wouldWrite && !dryRun && !controlDisarmed,
    dry_run: dryRun,
  });

  if (wouldWrite && !dryRun && !controlDisarmed && pushedValue !== null) {
    await pushSetpoint(
      deps.client,
      ctx.structureId,
      pushedValue,
      ctx.settings.setpoint_push_rounding_c,
    );
  }

  // --- Step 11: manual disarm override ------------------------------------
  const finalPositions: Record<string, number> = {
    ...pipelineResult.commandedPositions,
  };
  if (controlDisarmed) {
    for (const zone of zones) {
      if (!isControllable(zone.ventHardwareType)) continue;
      finalPositions[zone.id] = clampToZoneRange(
        zone.config.idle_baseline_position,
        zone.config.min_vent_position,
        zone.config.max_vent_position,
      );
    }
    // Deliberately not alertOnce/dedup-and-quiet — this is the plan's one
    // named exception: it re-fires on a coarse interval for as long as
    // control_disarmed stays true, since "a temporary check-in was never
    // reversed" is a risk a one-shot alert can't catch. Scoped per
    // installation (control_disarmed is global), not per air handler —
    // harmless double-send with today's one active handler, worth
    // revisiting if a second handler is ever activated.
    await deps.alerting.alertRecurring({
      key: `alert:controlDisarmed:${ctx.installationId}`,
      subject: "Control is disarmed",
      text: `Automatic control has been disarmed since it was last toggled — every smart vent is being held at its idle baseline instead of actively controlled. If this wasn't intentional, resume automatic control from the app.`,
      intervalHours: ctx.settings.disarm_reminder_interval_hours,
      nowMs: startedAtMs,
    });
  } else {
    await deps.alerting.clearRecurringAlert(
      `alert:controlDisarmed:${ctx.installationId}`,
    );
  }

  // --- Steps 12-13: dispatch ------------------------------------------
  let commandsDispatched = 0;
  for (const zone of zones) {
    if (!isControllable(zone.ventHardwareType)) continue;
    const target = finalPositions[zone.id];
    if (target === undefined) continue;
    const ventId = readings.get(zone.id)!.ventId;
    if (!ventId) continue;
    // One zone's Flair API failure (confirmed real, live — see
    // docs/flair-api-schema.md's write-boundary verification) must never
    // abort dispatch for every other zone on this air handler. On
    // failure, treat this zone as "not dispatched this tick" and keep
    // going — reconciliation/retry on a later tick is what recovers it,
    // not aborting the whole tick now.
    let dispatched = false;
    let lastDispatchedPosition = zone.state.last_reported_position;
    // Quiet actuation: a zone in an active Sleep Mode window dispatches
    // against a wider threshold, so small deviations accumulate into
    // fewer, larger movements instead of repeated small motor cycles —
    // see the "quiet actuation" comment on sleep_mode_min_step_delta_pct.
    const effectiveMinStepDeltaPct = sleepModeActiveByZone.get(zone.id)
      ? ctx.settings.sleep_mode_min_step_delta_pct
      : ctx.settings.min_step_delta_pct;
    try {
      const result = await dispatchZoneCommand({
        log,
        client: deps.client,
        airHandlerId: airHandler.id,
        zoneId: zone.id,
        ventId,
        targetPosition: target,
        lastDispatchedPosition: zone.state.last_reported_position,
        reportedPosition: readings.get(zone.id)!.reading.reportedPositionPct,
        minStepDeltaPct: effectiveMinStepDeltaPct,
        reconciliationQueue: deps.reconciliationQueue,
        nowMs: startedAtMs,
        actuationDelayMs: ACTUATION_DELAY_MS,
        dryRun,
      });
      dispatched = result.dispatched;
      lastDispatchedPosition = result.lastDispatchedPosition;
    } catch (err) {
      log.error(
        { zone_id: zone.id, err },
        "Vent dispatch failed — continuing with remaining zones",
      );
    }
    if (dispatched) commandsDispatched += 1;

    // --- Step 15: persist zone state ------------------------------------
    const reading = readings.get(zone.id)!.reading;
    await deps.persistZoneState(zone.id, {
      last_target_position: target,
      last_commanded_at:
        dispatched && !dryRun
          ? toIso(startedAtMs)
          : zone.state.last_commanded_at,
      last_reported_position: dryRun
        ? zone.state.last_reported_position
        : lastDispatchedPosition,
      last_reading_value: reading.calibratedTemp,
      last_reading_changed_at:
        reading.calibratedTemp !== null &&
        reading.calibratedTemp !== zone.state.last_reading_value
          ? toIso(startedAtMs)
          : zone.state.last_reading_changed_at,
      stale: zoneStaleness.get(zone.id) ?? false,
      spike_active: zoneSpike.get(zone.id)?.spiking ?? false,
      spike_since: zoneSpike.get(zone.id)?.belowThresholdSinceMs
        ? toIso(zoneSpike.get(zone.id)!.belowThresholdSinceMs!)
        : null,
      last_classification: (pipelineResult.classifications[zone.id] ?? null) as
        "satisfied" | "demanding" | "unclassified_no_sensor" | null,
      occupied: occupancyHysteresisByZone.get(zone.id)?.occupied ?? false,
      occupancy_pending_flip_since: occupancyHysteresisByZone.get(zone.id)
        ?.pendingFlipSince
        ? toIso(occupancyHysteresisByZone.get(zone.id)!.pendingFlipSince!)
        : null,
    });
  }

  await deps.airHandlerRuntimeStore.set(airHandler.id, {
    trackedDrivingZoneId: drivingSelection.zoneId,
    ticksSinceLeadChanged,
    smoothedOffsetC,
    lastPushedSetpointC: pushedValue,
    lastHvacState: hvac.state,
    callStartedAtMs,
    worstDeviationAtCallStartC,
    equipmentFaultActive: faultActive,
    equipmentFaultClearDwellSinceMs: faultClearDwellSinceMs,
    ticksSinceDriftCheck: nextTicksSinceDriftCheck,
  });

  const finishedAtMs = deps.now();
  const decision: AirHandlerTickDecision = {
    air_handler_id: airHandler.id,
    tick_at: toIso(startedAtMs),
    duration_ms: finishedAtMs - startedAtMs,
    dry_run: dryRun,
    control_disarmed: controlDisarmed,
    hvac_state: hvac.state,
    call_confidence: hvac.confidence,
    zones: zones.map((zone): ZoneTickDecision => ({
      zone_id: zone.id,
      name: zone.name,
      vent_hardware_type: zone.ventHardwareType,
      classification:
        pipelineResult.classifications[zone.id] ?? "unclassified_no_sensor",
      occupied: occupiedByZone.get(zone.id) ?? false,
      spiking: zoneSpike.get(zone.id)?.spiking ?? false,
      desired_position_pct: pipelineResult.commandedPositions[zone.id] ?? null,
      post_contention_position_pct:
        pipelineResult.commandedPositions[zone.id] ?? null,
      commanded_position_pct: finalPositions[zone.id] ?? null,
      reported_position_pct: readings.get(zone.id)!.reading.reportedPositionPct,
      dispatch_decision: isControllable(zone.ventHardwareType)
        ? "dispatched"
        : "not_applicable_no_vent",
      reason: "",
    })),
    contention: pipelineResult.contention,
    pressure: {
      aggregate_open_lps: aggregateOpenLps,
      aggregate_open_pct:
        topologyLimits.blowerRatedFlowRateLps > 0
          ? (aggregateOpenLps / topologyLimits.blowerRatedFlowRateLps) * 100
          : 0,
      floor_lps: floorLps,
      cap_pct: airHandler.config.pressure_cap_override_pct ?? 100,
      clamped: pipelineResult.pressureFloorClamped,
    },
    driving_zone: { zone_id: drivingSelection.zoneId, reason: selectionReason },
    setpoint_push: {
      pushed_value: pushedValue,
      pushed_value_c: pushedValue,
      thermostat_reading: snapshot.thermostatState?.ambientTemperatureC ?? null,
      would_write: wouldWrite && !dryRun && !controlDisarmed,
      demanding_zone_count: demandingZoneCount,
    },
    narrative: `${hvac.state}, tracking ${drivingSelection.zoneId ?? "no zone"} (${selectionReason}). ${commandsDispatched} command(s) dispatched.`,
  };

  logControlTickCompleted(log, {
    air_handler_id: airHandler.id,
    duration_ms: decision.duration_ms,
    zones_evaluated: zones.length,
    commands_dispatched: commandsDispatched,
  });
  finalize(log, decision);
  return decision;
}

function finalize(
  log: ReturnType<typeof logger.child>,
  decision: AirHandlerTickDecision,
): void {
  cacheTickDecision(decision);
  logControlTickDecision(log, decision);
}

function buildMinimalDecision(
  airHandlerId: string,
  startedAtMs: number,
  finishedAtMs: number,
  dryRun: boolean,
  hvac: { state: string; confidence: "reported" | "unknown" },
): AirHandlerTickDecision {
  return {
    air_handler_id: airHandlerId,
    tick_at: toIso(startedAtMs),
    duration_ms: finishedAtMs - startedAtMs,
    dry_run: dryRun,
    control_disarmed: false,
    hvac_state: hvac.state,
    call_confidence: hvac.confidence,
    zones: [],
    contention: null,
    pressure: null,
    driving_zone: null,
    setpoint_push: null,
    narrative:
      "No Flair zone linked to this air handler — nothing to evaluate.",
  };
}

function buildFaultDecision(
  airHandlerId: string,
  startedAtMs: number,
  finishedAtMs: number,
  dryRun: boolean,
  hvac: { state: string; confidence: "reported" | "unknown" },
  zones: ZoneData[],
): AirHandlerTickDecision {
  return {
    air_handler_id: airHandlerId,
    tick_at: toIso(startedAtMs),
    duration_ms: finishedAtMs - startedAtMs,
    dry_run: dryRun,
    control_disarmed: false,
    hvac_state: hvac.state,
    call_confidence: hvac.confidence,
    zones: zones.map((zone) => ({
      zone_id: zone.id,
      name: zone.name,
      vent_hardware_type: zone.ventHardwareType,
      classification: "unclassified_no_sensor",
      occupied: false,
      spiking: false,
      desired_position_pct: 100,
      post_contention_position_pct: 100,
      commanded_position_pct: isControllable(zone.ventHardwareType)
        ? 100
        : null,
      reported_position_pct: null,
      dispatch_decision: isControllable(zone.ventHardwareType)
        ? "dispatched"
        : "not_applicable_no_vent",
      reason:
        "Emergency fail-safe active — forced open, bypassing all other logic.",
    })),
    contention: null,
    pressure: null,
    driving_zone: null,
    setpoint_push: null,
    narrative:
      "Emergency fail-safe active: every smart vent forced to 100% open.",
  };
}

async function holdAtIdleBaseline(params: {
  airHandler: AirHandlerData;
  zones: ZoneData[];
  readings: Map<
    string,
    { reading: ReturnType<typeof ingestZoneReading>; ventId: string | null }
  >;
  ctx: TickContext;
  deps: TickDeps;
  log: ReturnType<typeof logger.child>;
  dryRun: boolean;
  startedAtMs: number;
  hvac: { state: string; confidence: "reported" | "unknown" };
}): Promise<AirHandlerTickDecision> {
  const { airHandler, zones, readings, deps, log, dryRun, startedAtMs, hvac } =
    params;
  for (const zone of zones) {
    if (!isControllable(zone.ventHardwareType)) continue;
    const ventId = readings.get(zone.id)?.ventId;
    if (!ventId) continue;
    const target = clampToZoneRange(
      zone.config.idle_baseline_position,
      zone.config.min_vent_position,
      zone.config.max_vent_position,
    );
    // Same reasoning as the other two dispatch loops: one zone's Flair API
    // failure must not stop the rest from being held at their idle
    // baseline while call-state confidence is unknown.
    try {
      await dispatchZoneCommand({
        log,
        client: deps.client,
        airHandlerId: airHandler.id,
        zoneId: zone.id,
        ventId,
        targetPosition: target,
        lastDispatchedPosition: zone.state.last_reported_position,
        reportedPosition:
          readings.get(zone.id)?.reading.reportedPositionPct ?? null,
        minStepDeltaPct: 0,
        reconciliationQueue: deps.reconciliationQueue,
        nowMs: startedAtMs,
        actuationDelayMs: ACTUATION_DELAY_MS,
        dryRun,
      });
    } catch (err) {
      log.error(
        { zone_id: zone.id, err },
        "Vent dispatch failed while holding at idle baseline (unknown call confidence) — continuing with remaining zones",
      );
    }
  }
  return {
    air_handler_id: airHandler.id,
    tick_at: toIso(startedAtMs),
    duration_ms: 0,
    dry_run: dryRun,
    control_disarmed: false,
    hvac_state: hvac.state,
    call_confidence: hvac.confidence,
    zones: [],
    contention: null,
    pressure: null,
    driving_zone: null,
    setpoint_push: null,
    narrative:
      "Call state confidence unknown — every zone held at its idle baseline, never inferred from setpoint-vs-ambient.",
  };
}
