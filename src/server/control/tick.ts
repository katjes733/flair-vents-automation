import type { FlairClient } from "~/server/util/flair/client";
import { fetchAirHandlerSnapshot } from "~/server/util/flair/resources";
import {
  ingestZoneRoomReading,
  ingestZoneVentReading,
  type ZoneRoomReading,
  type ZoneVentReading,
} from "~/server/util/flair/ingest";
import { pushSetpoint } from "~/server/util/flair/commands";
import type { AirHandlerData } from "~/server/util/routes/airHandler";
import type { ZoneData } from "~/server/util/routes/zone";
import type { ScheduleData } from "~/server/util/routes/schedule";
import type { ManualOverrideRow } from "~/server/util/routes/manualOverride";
import type { SystemSettingsConfig } from "~/shared/schemas/systemSettings";
import { asAbsoluteTemp, asTempDelta } from "~/shared/types/temperature";
import {
  isZoneDegraded,
  zoneDegradedSince,
  patchVentState,
  ventState,
  type VentRuntimeState,
} from "~/shared/types/zone";

import {
  ARBITRARY_IDLE_CALL_STATE,
  type HvacCallState,
} from "~/server/domain/types";
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
import { applyAwayTargets } from "~/server/domain/targets/awayMode";
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
  resolveExplicitDrivingOverride,
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
  type VentTickDecision,
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

// A real, confirmed bug found live via telemetry review: both
// detectEquipmentFault and detectDuctAirflowAnomaly's own "usable" filter
// exists specifically to exclude a stale duct-temperature reading from the
// differential check (see emergency.ts's own doc comment) — but every
// caller here used to hardcode `ductReadingStale: false` unconditionally,
// so that exclusion could never actually fire. A duct reading frozen from
// before a call finished cooling reads *warm* once stale, and with no
// staleness filter that frozen-warm reading gets evaluated as if it were
// live and failing — a plain upstream Flair data-refresh gap (already a
// known, documented characteristic of this API) could then trip a real
// Emergency Fail-Safe with no genuine equipment problem at all. Confirmed
// live: two fail-safe triggers correlated exactly with every smart-vent
// zone's *room* reading also going stale in the same tick, strongly
// suggesting the same underlying Flair snapshot gap silently fed a frozen
// duct reading into the "fault" conclusion too.
function isDuctReadingStale(
  createdAt: string | null,
  nowMs: number,
  staleThresholdMinutes: number,
): boolean {
  const createdAtMs = parseIsoOrNull(createdAt);
  if (createdAtMs === null) return true;
  return nowMs - createdAtMs > staleThresholdMinutes * 60000;
}

// One room-scoped reading (temperature/occupancy) plus one entry per
// zone.config.flair_vents member, same order — see "Multi-Vent Zones".
interface ZoneReadingBundle {
  room: ZoneRoomReading;
  vents: ZoneVentReading[];
}

// Reconciliation keys are `${zoneId}:${flairVentId}` — a zone id is always
// a well-formed UUID (never contains ":"), so the first ":" unambiguously
// separates the two, even though a Flair vent id's own format isn't
// guaranteed colon-free.
function reconciliationKey(zoneId: string, flairVentId: string): string {
  return `${zoneId}:${flairVentId}`;
}
function parseReconciliationKey(key: string): {
  zoneId: string;
  flairVentId: string;
} {
  const i = key.indexOf(":");
  return { zoneId: key.slice(0, i), flairVentId: key.slice(i + 1) };
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
  const readings = new Map<string, ZoneReadingBundle>(
    zones.map((zone) => {
      const room = zone.flairRoomId
        ? (snapshot.roomsById.get(zone.flairRoomId) ?? null)
        : null;
      const occupancyReading = room
        ? (snapshot.occupancyReadingByRoomId.get(room.id) ?? null)
        : null;
      const vents = zone.config.flair_vents.map(({ flair_vent_id }) => {
        const vent = snapshot.ventsById.get(flair_vent_id) ?? null;
        const ventReading = vent
          ? (snapshot.ventReadingsByVentId.get(vent.id) ?? null)
          : null;
        return ingestZoneVentReading({
          flairVentId: flair_vent_id,
          vent,
          ventReading,
        });
      });
      return [
        zone.id,
        {
          room: ingestZoneRoomReading({
            zoneId: zone.id,
            room,
            occupancyReading,
            calibrationOffsetC: asTempDelta(
              zone.config.sensor_calibration_offset,
            ),
          }),
          vents,
        },
      ] as const;
    }),
  );

  // Per-tick accumulator of each zone's latest `vents` array — seeded from
  // the start-of-tick snapshot, updated every time any step below patches
  // a vent. Required because several steps this tick (reconciliation,
  // fail-safe dispatch, the main dispatch loop) can each touch the SAME
  // zone's vents array: without a shared accumulator, each step would
  // independently read the stale pre-tick `zone.state.vents`, and
  // whichever step's persistZoneState call lands last would silently
  // overwrite every earlier step's update to that same zone (a plain
  // object-spread merge can't help here, since the whole array is one
  // field). See "Multi-Vent Zones".
  const currentVentsByZoneId = new Map<string, VentRuntimeState[]>(
    zones.map((z) => [z.id, z.state.vents]),
  );
  function ventStateNow(
    zoneId: string,
    flairVentId: string,
  ): VentRuntimeState | undefined {
    return currentVentsByZoneId
      .get(zoneId)
      ?.find((v) => v.flair_vent_id === flairVentId);
  }

  // --- Step 3: reconciliation sweep ------------------------------------
  // Reuses the readings just fetched — zero extra Flair API calls, per
  // "Reconciliation & startup reconciliation". Per (zone, vent) pair —
  // two vents in the same zone reconcile independently. See "Multi-Vent
  // Zones".
  //
  // Skipped entirely for a shadowed handler ("Shadow mode (dry run)"):
  // no command was ever actually sent for Flair to have acted on, so
  // there's nothing real to reconcile — evaluating it anyway would
  // compare a never-dispatched target against Flair's own independently
  // driven reported position, which will essentially never converge and
  // would exhaust retries into a false "degraded" state. Left queued
  // (not dequeued) until the handler goes live, at which point it's
  // evaluated for real.
  if (!dryRun) {
    const dueKeys = await deps.reconciliationQueue.dequeueDue(startedAtMs);
    for (const key of dueKeys) {
      const { zoneId, flairVentId } = parseReconciliationKey(key);
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) continue;
      const ventReading = readings
        .get(zoneId)
        ?.vents.find((v) => v.flairVentId === flairVentId);
      const reportedPosition = ventReading?.reportedPositionPct ?? null;
      const priorVent = ventStateNow(zoneId, flairVentId);
      const currentVents = currentVentsByZoneId.get(zoneId) ?? [];
      const outcome = evaluateReconciliation({
        targetPosition: zone.state.last_target_position ?? 0,
        reportedPosition,
        minStepDeltaPct: ctx.settings.min_step_delta_pct,
        attemptsSoFar: priorVent?.reconcile_attempts ?? 0,
        maxAttempts: ctx.settings.reconciliation_retry_count,
        dueForCheck: true,
      });
      if (outcome.status === "reconciled") {
        logVentReconciled(log, {
          air_handler_id: airHandler.id,
          zone_id: zoneId,
          vent_id: flairVentId,
          attempt: priorVent?.reconcile_attempts ?? 0,
          reported_pct: reportedPosition ?? 0,
        });
        const vents = patchVentState(currentVents, flairVentId, {
          reconcile_attempts: 0,
          degraded: false,
          degraded_since: null,
        });
        currentVentsByZoneId.set(zoneId, vents);
        await deps.persistZoneState(zoneId, { vents });
      } else if (outcome.status === "retry") {
        await deps.reconciliationQueue.enqueue(
          key,
          startedAtMs + ACTUATION_DELAY_MS,
        );
        const vents = patchVentState(currentVents, flairVentId, {
          reconcile_attempts: outcome.attempt,
        });
        currentVentsByZoneId.set(zoneId, vents);
        await deps.persistZoneState(zoneId, { vents });
      } else if (outcome.status === "degraded") {
        logVentDegraded(log, {
          air_handler_id: airHandler.id,
          zone_id: zoneId,
          vent_id: flairVentId,
          reconcile_attempts: priorVent?.reconcile_attempts ?? 0,
          last_reported_pct: reportedPosition,
        });
        const vents = patchVentState(currentVents, flairVentId, {
          degraded: true,
          degraded_since: toIso(startedAtMs),
        });
        currentVentsByZoneId.set(zoneId, vents);
        await deps.persistZoneState(zoneId, { vents });
      }
    }
  }

  // --- Periodic drift-check backstop ------------------------------------
  // Independent of whether a reconciliation is currently pending — a vent
  // that already reconciled successfully can still drift afterward, since
  // it has no true position feedback (confirmed live — see
  // docs/flair-api-schema.md's write-boundary verification). Costs zero
  // extra Flair API calls: reported positions are already in `readings`
  // from Step 1. Per (zone, vent) pair. See "Resolved Design Decisions"
  // and "Multi-Vent Zones".
  const ticksSinceDriftCheck = priorRuntime.ticksSinceDriftCheck + 1;
  const driftCheckDue =
    ticksSinceDriftCheck >= ctx.settings.drift_check_interval_ticks;
  const nextTicksSinceDriftCheck = driftCheckDue ? 0 : ticksSinceDriftCheck;
  if (driftCheckDue) {
    let ventsChecked = 0;
    let mismatchesFound = 0;
    for (const zone of zones) {
      if (!isControllable(zone.ventHardwareType)) continue;
      if (zone.state.last_target_position === null) continue;
      for (const ventReading of readings.get(zone.id)?.vents ?? []) {
        const reportedPosition = ventReading.reportedPositionPct;
        if (reportedPosition === null) continue;
        ventsChecked += 1;
        if (
          detectDrift({
            reportedPosition,
            lastTargetPosition: zone.state.last_target_position,
            minStepDeltaPct: ctx.settings.min_step_delta_pct,
          })
        ) {
          mismatchesFound += 1;
          // Detection/counting still runs while shadowed (real diagnostic
          // signal — this is exactly the shadow-mode target-vs-reported
          // comparison), but only a *live* handler's drift is real drift
          // worth enqueueing a reconciliation for. A shadowed handler's
          // `last_target_position` was never actually dispatched, so a
          // "mismatch" against Flair's own independently reported
          // position is expected, not a hardware problem — enqueueing it
          // would exhaust retries into a false "degraded" state, exactly
          // as the Step 3 sweep's own dryRun gate above avoids.
          if (!dryRun) {
            await deps.reconciliationQueue.enqueue(
              reconciliationKey(zone.id, ventReading.flairVentId),
              startedAtMs,
            );
          }
        }
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
  // The single shared "which direction" input for every computation below
  // that needs a call-direction decision but isn't itself gated on
  // callActive (away/fallback setpoint selection, driving-zone deviation,
  // setpoint-push termination direction) — mirrors pipeline.ts's own
  // ARBITRARY_IDLE_CALL_STATE convention. A real, confirmed bug this fixes:
  // each of those four call sites used to compare the raw `hvac.state`
  // against a literal `"COOLING_CALL"` directly, which is always false
  // during FAN_ONLY/IDLE regardless of which direction the system actually
  // runs — silently resolving the *heat* setpoint/deviation direction on
  // every idle/fan tick for this cooling-focused household. One shared
  // value here instead of four independent copies of the same ternary is
  // exactly what stops a fifth copy from drifting the same way.
  const effectiveCallState: HvacCallState = callActive
    ? (hvac.state as HvacCallState)
    : ARBITRARY_IDLE_CALL_STATE;

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
  // One entry per VENT, not per zone — a 2-vent zone contributes 2
  // entries — since detectEquipmentFault/detectDuctAirflowAnomaly already
  // treat this as a flat list, tolerant of duplicate zoneIds. See
  // "Multi-Vent Zones".
  const ductZones: DuctReadingZone[] = zones
    .filter((z) => isControllable(z.ventHardwareType))
    .flatMap((z) => {
      const bundle = readings.get(z.id)!;
      const roomTemperatureC = bundle.room.calibratedTemp ?? Number.NaN;
      return bundle.vents.map((v) => ({
        zoneId: z.id,
        ventId: v.flairVentId,
        hasSmartVent: true,
        ductTemperatureC: v.ductTemperatureC,
        ductReadingStale: isDuctReadingStale(
          v.ductReadingCreatedAt,
          startedAtMs,
          ctx.settings.stale_threshold_minutes,
        ),
        roomTemperatureC,
        demanding: false,
        commandedPositionPct: 0,
      }));
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
      const ventReadings = readings.get(zone.id)!.vents;
      let vents = currentVentsByZoneId.get(zone.id) ?? zone.state.vents;
      // Fail-safe is the one dispatch path where a per-vent write failure
      // must never be allowed to abort the loop — every other vent still
      // needs its unconditional 100% command regardless of one vent's
      // Flair API error (a confirmed real failure mode — see
      // docs/flair-api-schema.md's live write-boundary verification).
      for (const ventReading of ventReadings) {
        try {
          const { lastDispatchedPosition } = await dispatchZoneCommand({
            log,
            client: deps.client,
            airHandlerId: airHandler.id,
            zoneId: zone.id,
            ventId: ventReading.flairVentId,
            targetPosition: target,
            lastDispatchedPosition:
              ventStateNow(zone.id, ventReading.flairVentId)
                ?.last_reported_position ?? null,
            reportedPosition: ventReading.reportedPositionPct,
            minStepDeltaPct: 0, // fail-safe bypasses the step-delta suppressor entirely
            reconciliationQueue: deps.reconciliationQueue,
            nowMs: startedAtMs,
            actuationDelayMs: ACTUATION_DELAY_MS,
            dryRun,
          });
          vents = patchVentState(vents, ventReading.flairVentId, {
            last_reported_position: lastDispatchedPosition,
          });
          currentVentsByZoneId.set(zone.id, vents);
        } catch (err) {
          log.error(
            { zone_id: zone.id, vent_id: ventReading.flairVentId, err },
            "Vent dispatch failed during emergency fail-safe — continuing with remaining vents",
          );
        }
      }
      await deps.persistZoneState(zone.id, {
        last_target_position: target,
        last_commanded_at: dryRun
          ? zone.state.last_commanded_at
          : toIso(startedAtMs),
        vents,
      });
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
    const reading = readings.get(zone.id)!.room;
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

    // Zone-level rollup: degraded if ANY of its vents are. degraded_since
    // is the MIN over currently-degraded vents' own timestamps, so a
    // long-stuck vent's timer isn't reset by an unrelated sibling
    // recovering. See "Multi-Vent Zones".
    const degradedAlertKey = `alert:ventDegraded:${zone.id}`;
    const zoneDegradedSinceIso = zoneDegradedSince(zone.state);
    const degradedSinceMs = zoneDegradedSinceIso
      ? new Date(zoneDegradedSinceIso).getTime()
      : null;
    if (isZoneDegraded(zone.state) && degradedSinceMs !== null) {
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
  const awayTargets = applyAwayTargets({
    awaySetpointCool: asAbsoluteTemp(ctx.settings.away_setpoint_cool),
    awaySetpointHeat: asAbsoluteTemp(ctx.settings.away_setpoint_heat),
    awayTolerance: asTempDelta(ctx.settings.away_tolerance),
    state: effectiveCallState,
  });
  const fallback = {
    setpoint: asAbsoluteTemp(
      effectiveCallState === "COOLING_CALL"
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
      // A real, confirmed bug found live via shadow-mode evaluation: this
      // used to be `hvac.state as "COOLING_CALL" | "HEATING_CALL"` — a cast
      // that lied about `hvac.state` always being a real call state, so
      // every IDLE/FAN_ONLY tick silently fell through to the *heating*
      // setpoint for this cooling-only household. Now uses the same shared
      // effectiveCallState every other non-callActive-gated call-direction
      // decision this tick uses, instead of its own independent copy of
      // the same fallback ternary — see effectiveCallState's own comment.
      state: effectiveCallState,
      minimumComfortTolerance: asTempDelta(
        ctx.settings.minimum_comfort_tolerance_c,
      ),
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
    const reading = readings.get(zone.id)!.room;
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
    const reading = readings.get(zone.id)!.room;
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
      // Sum of each vent's own rating (falling back to the standard
      // default per vent left blank) — the ganged position still means
      // every vent in the zone is at the same commanded %, so this is
      // exactly the same aggregate contribution the old single combined
      // duct_flow_rate_lps value represented, just entered per vent
      // instead of pre-summed by hand. 0 for manual_fixed_vent/no_vent
      // (flair_vents is always empty for those types) — harmless, since
      // this field is never read for either.
      flowRateLps: zone.config.flair_vents.reduce(
        (sum, v) =>
          sum +
          (v.duct_flow_rate_lps ?? ctx.settings.default_zone_flow_rate_lps),
        0,
      ),
      manualVents: zone.config.manual_vents.map((v) => ({
        position: v.position,
        flowRateLps:
          v.duct_flow_rate_lps ?? ctx.settings.default_zone_flow_rate_lps,
      })),
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
      degraded: isZoneDegraded(zone.state),
      previousClassification: zone.state.last_classification,
      previousPendingClassification: zone.state.classification_pending_value,
      previousPendingSinceMs: parseIsoOrNull(
        zone.state.classification_pending_since,
      ),
    };
  });

  const pipelineResult = computeZoneCommands({
    state: hvac.state,
    zones: pipelineInputs,
    nowMs: startedAtMs,
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
      classificationStabilizationMinutes:
        ctx.settings.classification_stabilization_minutes,
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
      if (z.degraded) return sum;
      if (z.ventHardwareType === "manual_fixed_vent") {
        return (
          sum +
          z.manualVents.reduce(
            (vSum, v) => vSum + (v.position / 100) * v.flowRateLps,
            0,
          )
        );
      }
      const pos = pipelineResult.commandedPositions[z.zoneId] ?? 0;
      return sum + (pos / 100) * z.flowRateLps;
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
    const reading = readings.get(zone.id)!.room;
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
  // One entry per vent (see Step 5 above). Tracking/alert keys are
  // compound `${zoneId}:${ventId}` — a real bug otherwise: with two
  // vents' results processed sequentially in the same tick, a healthy
  // sibling's "not anomalous" branch would immediately clear the *other*
  // vent's just-recorded anomaly timer and alert, permanently masking a
  // real, sustained single-vent duct problem for as long as the sibling
  // stays healthy. See "Multi-Vent Zones".
  if (callActive) {
    const anomalyZones: DuctReadingZone[] = zones
      .filter((z) => isControllable(z.ventHardwareType))
      .flatMap((z) => {
        const bundle = readings.get(z.id)!;
        const roomTemperatureC = bundle.room.calibratedTemp ?? Number.NaN;
        return bundle.vents.map((v) => ({
          zoneId: z.id,
          ventId: v.flairVentId,
          hasSmartVent: true,
          ductTemperatureC: v.ductTemperatureC,
          ductReadingStale: isDuctReadingStale(
            v.ductReadingCreatedAt,
            startedAtMs,
            ctx.settings.stale_threshold_minutes,
          ),
          roomTemperatureC,
          demanding: pipelineResult.classifications[z.id] === "demanding",
          commandedPositionPct: pipelineResult.commandedPositions[z.id] ?? 0,
        }));
      })
      .filter((z) => Number.isFinite(z.roomTemperatureC));
    const anomalies = detectDuctAirflowAnomaly({
      state: hvac.state as "COOLING_CALL" | "HEATING_CALL",
      ductDeltaThresholdC: ctx.settings.equipment_fault_duct_delta_threshold_c,
      zones: anomalyZones,
    });
    for (const a of anomalies) {
      const trackingKey = reconciliationKey(a.zoneId, a.ventId ?? "");
      const anomalyAlertKey = `alert:ductAnomaly:${trackingKey}`;
      const demandTracking =
        await deps.zoneDemandTrackingStore.get(trackingKey);
      if (a.anomalous) {
        logDuctAirflowAnomalyDetected(log, {
          air_handler_id: airHandler.id,
          zone_id: a.zoneId,
          vent_id: a.ventId ?? "",
          duct_delta_c: null,
          commanded_position_pct:
            pipelineResult.commandedPositions[a.zoneId] ?? 0,
        });
        const since = demandTracking.ductAnomalySinceMs ?? startedAtMs;
        const anomalyMinutes = (startedAtMs - since) / 60000;
        await deps.zoneDemandTrackingStore.set(trackingKey, {
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
        await deps.zoneDemandTrackingStore.set(trackingKey, {
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
      const reading = readings.get(z.id)!.room;
      const target = targetsByZone.get(z.id)!;
      // A real, confirmed bug: this used to compare the raw `hvac.state`
      // against a literal "COOLING_CALL", which is always false during
      // FAN_ONLY/IDLE regardless of which direction the system actually
      // runs. Since every candidate's deviation flips sign uniformly, the
      // effect wasn't just "wrong magnitude" — among zones already
      // correctly flagged demanding, it inverted the worst-off ranking
      // (a room barely over its setpoint would look "worse" than one
      // spiking hard), so the setpoint push could get calibrated to the
      // wrong zone's offset during every idle/fan gap. See
      // effectiveCallState's own comment.
      const deviation =
        reading.calibratedTemp !== null && target.setpoint !== null
          ? effectiveCallState === "COOLING_CALL"
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

  const explicitOverrideZoneId = resolveExplicitDrivingOverride({
    airHandlerId: airHandler.id,
    eventOverridesByZone: zones.map(
      (z) => governingEventByZone.get(z.id)?.event.driving_zone_overrides,
    ),
    globalOverride: ctx.settings.driving_zone_overrides[airHandler.id] ?? null,
  });
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
      // A real, confirmed bug: this used to cast the raw `hvac.state`
      // rather than substituting effectiveCallState, so the termination
      // branch's min/max direction (only reachable once demandingZoneCount
      // is 0) picked the wrong direction during FAN_ONLY/IDLE — see
      // effectiveCallState's own comment.
      state: effectiveCallState,
      trackedZoneSetpoint: trackedTarget.setpoint ?? 0,
      trackedZoneTemp: readings.get(trackedZone.id)!.room.calibratedTemp,
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
  // Per vent, not per zone — every vent in a zone is ganged to the same
  // target, but dispatches/reconciles/persists independently, since one
  // vent's own last-dispatched-position must never suppress a correction
  // to a stuck sibling. See "Multi-Vent Zones".
  let commandsDispatched = 0;
  // Captured per vent for the tick decision record built below — the
  // dispatch outcome and post-dispatch degraded state aren't otherwise
  // available once this loop ends.
  const dispatchDecisionByVentKey = new Map<
    string,
    "dispatched" | "suppressed_step_delta"
  >();
  // How close each vent is to its next real dispatch — see
  // VentTickDecision's own step_delta_pct/min_step_delta_pct doc comment.
  const stepDeltaByVentKey = new Map<
    string,
    { stepDeltaPct: number; minStepDeltaPct: number }
  >();
  const zoneDispatchedThisTickByZoneId = new Map<string, boolean>();
  for (const zone of zones) {
    if (!isControllable(zone.ventHardwareType)) continue;
    const target = finalPositions[zone.id];
    if (target === undefined) continue;
    const ventReadings = readings.get(zone.id)!.vents;
    if (ventReadings.length === 0) continue;
    // Quiet actuation: a zone in an active Sleep Mode window dispatches
    // against a wider threshold, so small deviations accumulate into
    // fewer, larger movements instead of repeated small motor cycles —
    // see the "quiet actuation" comment on sleep_mode_min_step_delta_pct.
    const effectiveMinStepDeltaPct = sleepModeActiveByZone.get(zone.id)
      ? ctx.settings.sleep_mode_min_step_delta_pct
      : ctx.settings.min_step_delta_pct;

    let vents = currentVentsByZoneId.get(zone.id) ?? zone.state.vents;
    let zoneDispatchedThisTick = false;
    for (const ventReading of ventReadings) {
      const priorVent = ventStateNow(zone.id, ventReading.flairVentId);
      // One vent's Flair API failure (confirmed real, live — see
      // docs/flair-api-schema.md's write-boundary verification) must
      // never abort dispatch for every other vent on this air handler.
      // On failure, treat this vent as "not dispatched this tick" and
      // keep going — reconciliation/retry on a later tick is what
      // recovers it, not aborting the whole tick now.
      try {
        const result = await dispatchZoneCommand({
          log,
          client: deps.client,
          airHandlerId: airHandler.id,
          zoneId: zone.id,
          ventId: ventReading.flairVentId,
          targetPosition: target,
          lastDispatchedPosition: priorVent?.last_reported_position ?? null,
          reportedPosition: ventReading.reportedPositionPct,
          minStepDeltaPct: effectiveMinStepDeltaPct,
          reconciliationQueue: deps.reconciliationQueue,
          nowMs: startedAtMs,
          actuationDelayMs: ACTUATION_DELAY_MS,
          dryRun,
        });
        if (result.dispatched) {
          commandsDispatched += 1;
          zoneDispatchedThisTick = true;
        }
        dispatchDecisionByVentKey.set(
          reconciliationKey(zone.id, ventReading.flairVentId),
          result.dispatched ? "dispatched" : "suppressed_step_delta",
        );
        stepDeltaByVentKey.set(
          reconciliationKey(zone.id, ventReading.flairVentId),
          {
            stepDeltaPct: result.stepDeltaPct,
            minStepDeltaPct: effectiveMinStepDeltaPct,
          },
        );
        // A real, confirmed bug found live via shadow-mode evaluation: this
        // used to freeze last_reported_position (this app's own persisted
        // "last thing we told this vent," which the step-delta suppressor
        // above reads back as lastDispatchedPosition) whenever dryRun was
        // true, instead of always advancing it like every other piece of
        // ramp state does. Shadow mode's own stated guarantee is that
        // dispatch state "advances exactly as it would live" — with this
        // frozen, a shadowed zone's dispatch decision kept comparing
        // against the exact same stale baseline forever, so once a zone's
        // target drifted far enough from it to cross the threshold once,
        // every subsequent tick recomputed the identical "would dispatch"
        // answer indefinitely, never settling into "no change needed"
        // even after the target itself stopped moving. The fail-safe
        // dispatch path a few hundred lines up never had this bug — it
        // always advances unconditionally, which is the correct behavior
        // this now matches.
        vents = patchVentState(vents, ventReading.flairVentId, {
          last_reported_position: result.lastDispatchedPosition,
        });
        currentVentsByZoneId.set(zone.id, vents);
      } catch (err) {
        log.error(
          { zone_id: zone.id, vent_id: ventReading.flairVentId, err },
          "Vent dispatch failed — continuing with remaining vents",
        );
      }
    }
    zoneDispatchedThisTickByZoneId.set(zone.id, zoneDispatchedThisTick);
  }

  // --- Step 15: persist zone state ------------------------------------
  // Runs for every zone, not just controllable ones with a target and
  // live vent readings (the loop above's own dispatch-specific gates) —
  // a no_vent zone still needs its reading/classification/staleness/
  // spike/occupancy persisted (see "Zone Hardware & Sensor Type Matrix":
  // classification applies "iff sensored", independent of vent type)
  // even though it has nothing to dispatch. Previously this lived inside
  // the dispatch loop above, so a no_vent zone's state was never
  // persisted past its initial creation — found live: a sensored,
  // vent-less imported zone showed no reading in the UI.
  for (const zone of zones) {
    const reading = readings.get(zone.id)!.room;
    const vents = currentVentsByZoneId.get(zone.id) ?? zone.state.vents;
    const target = finalPositions[zone.id] ?? zone.state.last_target_position;
    const zoneDispatchedThisTick =
      zoneDispatchedThisTickByZoneId.get(zone.id) ?? false;
    await deps.persistZoneState(zone.id, {
      last_target_position: target,
      last_commanded_at:
        zoneDispatchedThisTick && !dryRun
          ? toIso(startedAtMs)
          : zone.state.last_commanded_at,
      vents,
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
      classification_pending_value:
        pipelineResult.classificationPending[zone.id]?.value ?? null,
      classification_pending_since: pipelineResult.classificationPending[
        zone.id
      ]?.sinceMs
        ? toIso(pipelineResult.classificationPending[zone.id]!.sinceMs!)
        : null,
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
    equipment_fault_active: faultActive,
    hvac_state: hvac.state,
    call_confidence: hvac.confidence,
    zones: zones.map((zone): ZoneTickDecision => {
      const finalVents = currentVentsByZoneId.get(zone.id) ?? zone.state.vents;
      return {
        zone_id: zone.id,
        name: zone.name,
        vent_hardware_type: zone.ventHardwareType,
        classification:
          pipelineResult.classifications[zone.id] ?? "unclassified_no_sensor",
        occupied: occupiedByZone.get(zone.id) ?? false,
        spiking: zoneSpike.get(zone.id)?.spiking ?? false,
        temp_calibrated: readings.get(zone.id)?.room.calibratedTemp ?? null,
        resolved_setpoint: targetsByZone.get(zone.id)?.setpoint ?? null,
        desired_position_pct:
          pipelineResult.commandedPositions[zone.id] ?? null,
        post_contention_position_pct:
          pipelineResult.commandedPositions[zone.id] ?? null,
        vents: (readings.get(zone.id)?.vents ?? []).map(
          (v): VentTickDecision => ({
            flair_vent_id: v.flairVentId,
            name: v.name,
            commanded_position_pct: finalPositions[zone.id] ?? null,
            reported_position_pct: v.reportedPositionPct,
            dispatch_decision:
              dispatchDecisionByVentKey.get(
                reconciliationKey(zone.id, v.flairVentId),
              ) ?? "suppressed_step_delta",
            step_delta_pct:
              stepDeltaByVentKey.get(reconciliationKey(zone.id, v.flairVentId))
                ?.stepDeltaPct ?? null,
            min_step_delta_pct:
              stepDeltaByVentKey.get(reconciliationKey(zone.id, v.flairVentId))
                ?.minStepDeltaPct ?? null,
            degraded:
              finalVents.find((fv) => fv.flair_vent_id === v.flairVentId)
                ?.degraded ?? false,
            voltage: v.voltage,
            current_rssi: v.currentRssi,
          }),
        ),
        reason: "",
      };
    }),
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
      thermostat_current_setpoint:
        snapshot.thermostatState?.targetTemperatureC ?? null,
      would_write: wouldWrite && !dryRun && !controlDisarmed,
      demanding_zone_count: demandingZoneCount,
    },
    narrative: `${hvac.state}, tracking ${
      drivingSelection.zoneId
        ? (zones.find((z) => z.id === drivingSelection.zoneId)?.name ??
          drivingSelection.zoneId)
        : "no zone"
    } (${selectionReason}). ${commandsDispatched} command(s) dispatched.`,
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
    equipment_fault_active: false,
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
    equipment_fault_active: true,
    hvac_state: hvac.state,
    call_confidence: hvac.confidence,
    zones: zones.map((zone) => ({
      zone_id: zone.id,
      name: zone.name,
      vent_hardware_type: zone.ventHardwareType,
      classification: "unclassified_no_sensor",
      occupied: false,
      spiking: false,
      // No live Flair snapshot is fetched on this path (the fault trigger
      // short-circuits before ingestion) — nothing to report.
      temp_calibrated: null,
      // The fail-safe path bypasses target resolution entirely — nothing
      // was actually compared against anything this tick.
      resolved_setpoint: null,
      desired_position_pct: 100,
      post_contention_position_pct: 100,
      vents: isControllable(zone.ventHardwareType)
        ? zone.config.flair_vents.map(({ flair_vent_id: flairVentId }) => ({
            flair_vent_id: flairVentId,
            // No live Flair snapshot is fetched on this path (the fault
            // trigger short-circuits before ingestion) — the client falls
            // back to an ordinal label for an empty name, and hardware
            // fields are unavailable for the same reason.
            name: "",
            commanded_position_pct: 100,
            reported_position_pct: null,
            dispatch_decision: "dispatched" as const,
            // The fail-safe path bypasses the step-delta suppressor
            // entirely (unconditional dispatch) — there's no accumulated
            // delta to report.
            step_delta_pct: null,
            min_step_delta_pct: null,
            degraded: false,
            voltage: null,
            current_rssi: null,
          }))
        : [],
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
  readings: Map<string, ZoneReadingBundle>;
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
    const ventReadings = readings.get(zone.id)?.vents ?? [];
    if (ventReadings.length === 0) continue;
    const target = clampToZoneRange(
      zone.config.idle_baseline_position,
      zone.config.min_vent_position,
      zone.config.max_vent_position,
    );
    // Same reasoning as the other dispatch loops: one vent's Flair API
    // failure must not stop the rest from being held at their idle
    // baseline while call-state confidence is unknown.
    for (const ventReading of ventReadings) {
      const priorVent = ventState(zone.state, ventReading.flairVentId);
      try {
        await dispatchZoneCommand({
          log,
          client: deps.client,
          airHandlerId: airHandler.id,
          zoneId: zone.id,
          ventId: ventReading.flairVentId,
          targetPosition: target,
          lastDispatchedPosition: priorVent?.last_reported_position ?? null,
          reportedPosition: ventReading.reportedPositionPct,
          minStepDeltaPct: 0,
          reconciliationQueue: deps.reconciliationQueue,
          nowMs: startedAtMs,
          actuationDelayMs: ACTUATION_DELAY_MS,
          dryRun,
        });
      } catch (err) {
        log.error(
          { zone_id: zone.id, vent_id: ventReading.flairVentId, err },
          "Vent dispatch failed while holding at idle baseline (unknown call confidence) — continuing with remaining vents",
        );
      }
    }
  }
  return {
    air_handler_id: airHandler.id,
    tick_at: toIso(startedAtMs),
    duration_ms: 0,
    dry_run: dryRun,
    control_disarmed: false,
    equipment_fault_active: false,
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
