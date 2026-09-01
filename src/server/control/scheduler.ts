import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { getActiveAirHandlers } from "~/server/util/routes/airHandler";
import {
  getZonesForAirHandler,
  updateZoneState,
} from "~/server/util/routes/zone";
import { getSchedulesForInstallation } from "~/server/util/routes/schedule";
import { getLatestOverridesForZones } from "~/server/util/routes/manualOverride";
import { getSystemSettings } from "~/server/util/routes/systemSettings";
import { FlairApiClient } from "~/server/util/flair/client";
import { fetchAirHandlerSnapshot } from "~/server/util/flair/resources";
import { isControllable } from "~/server/domain/zone/predicates";
import { createRedisReconciliationQueue } from "~/server/control/reconciliationQueue";
import { createRedisSpikeBufferStore } from "~/server/control/spikeBuffer";
import { createRedisAirHandlerRuntimeStore } from "~/server/control/airHandlerRuntimeStore";
import {
  runTick,
  type TickContext,
  type TickDeps,
} from "~/server/control/tick";
import { runStartupReconciliation } from "~/server/control/startupReconcile";

const log = logger.child({ service: "control-loop" });

// Fails closed, per "Environment & Dev Modes": unset, missing, or anything
// other than the literal string "false" means shadow mode. A missing env
// var must never be what lets a container start moving real vents.
function isDryRunEnv(): boolean {
  return process.env.DRY_RUN !== "false";
}

function isControlLoopEnabled(): boolean {
  return process.env.CONTROL_LOOP_ENABLED !== "false";
}

/**
 * Runs one full cycle — every active air handler on the one configured
 * installation, sequentially, sharing a single FlairClient (and therefore
 * a single OAuth token / rate-limit budget) across all of them, per "Loop
 * mechanism": more air handlers under the same account is a within-tick
 * concern, not a horizontal-scaling one.
 */
export async function runAllHandlers(): Promise<void> {
  const installation = await getOrCreateDefaultInstallation();
  if (!installation.flairStructureId) {
    log.debug("No Flair structure linked yet — skipping this cycle");
    return;
  }

  const settings = await getSystemSettings(installation.id);
  const schedules = await getSchedulesForInstallation(installation.id);
  const airHandlers = await getActiveAirHandlers(installation.id);
  const client = new FlairApiClient(installation.id);
  const reconciliationQueue = createRedisReconciliationQueue();
  const spikeBufferStore = createRedisSpikeBufferStore();
  const airHandlerRuntimeStore = createRedisAirHandlerRuntimeStore();
  const globalDryRun = isDryRunEnv();

  for (const airHandler of airHandlers) {
    const zones = await getZonesForAirHandler(airHandler.id);
    if (zones.length === 0) continue;

    const overridesByZoneId = await getLatestOverridesForZones(
      zones.map((z) => z.id),
    );
    // persistZoneState only ever receives a partial patch — merge it onto
    // the state this cycle already loaded (kept in memory here) before
    // writing the full row back, since updateZoneState replaces the whole
    // `state` column.
    const zoneStateById = new Map(zones.map((z) => [z.id, z.state]));

    const ctx: TickContext = {
      installationId: installation.id,
      structureId: installation.flairStructureId,
      settings,
      schedules,
      overridesByZoneId,
      globalDryRun,
    };
    const deps: TickDeps = {
      client,
      reconciliationQueue,
      spikeBufferStore,
      airHandlerRuntimeStore,
      persistZoneState: async (zoneId, patch) => {
        const current = zoneStateById.get(zoneId);
        if (!current) return;
        const merged = { ...current, ...patch };
        zoneStateById.set(zoneId, merged);
        await updateZoneState(zoneId, merged);
      },
      now: () => Date.now(),
    };

    // One air handler's failure (a Flair outage, a wedged fetch) must
    // never stop every other handler on the same installation from
    // getting its tick — same reasoning as the per-zone dispatch
    // robustness fix inside runTick itself.
    try {
      await runTick(airHandler, zones, ctx, deps);
    } catch (err) {
      log.error(
        { air_handler_id: airHandler.id, err },
        "Tick failed for air handler — continuing with remaining handlers",
      );
    }
  }
}

/**
 * Runs once, before the first scheduled tick — seeds each zone's ramp
 * origin from the vent's actual reported position (not whatever the DB
 * happened to hold across a restart), and enters a genuine drift beyond
 * min_step_delta_pct into the normal retry/degrade path exactly as a live
 * reconciliation failure would. See "Reconciliation & startup
 * reconciliation".
 */
export async function runStartupReconciliationForInstallation(): Promise<void> {
  const installation = await getOrCreateDefaultInstallation();
  if (!installation.flairStructureId) return;

  const settings = await getSystemSettings(installation.id);
  const airHandlers = await getActiveAirHandlers(installation.id);
  const client = new FlairApiClient(installation.id);
  const reconciliationQueue = createRedisReconciliationQueue();

  for (const airHandler of airHandlers) {
    if (!airHandler.flairZoneId) continue;
    const zones = await getZonesForAirHandler(airHandler.id);
    const controllableZones = zones.filter((z) =>
      isControllable(z.ventHardwareType),
    );
    if (controllableZones.length === 0) continue;

    const snapshot = await fetchAirHandlerSnapshot(
      client,
      installation.flairStructureId,
      airHandler.flairZoneId,
    );
    const handlerLog = log.child({ air_handler_id: airHandler.id });

    const zoneInputs = controllableZones.map((zone) => {
      const room = zone.flairRoomId
        ? (snapshot.roomsById.get(zone.flairRoomId) ?? null)
        : null;
      const vent = room ? (snapshot.ventsByRoomId.get(room.id) ?? null) : null;
      return {
        zoneId: zone.id,
        reportedPosition: vent?.percentOpen ?? null,
        lastTargetPosition: zone.state.last_target_position,
        minStepDeltaPct: settings.min_step_delta_pct,
      };
    });

    const result = await runStartupReconciliation({
      log: handlerLog,
      airHandlerId: airHandler.id,
      zones: zoneInputs,
      reconciliationQueue,
      nowMs: Date.now(),
    });

    for (const zone of controllableZones) {
      const seeded = result.seedLastCommandedTarget.get(zone.id);
      if (seeded === undefined) continue;
      await updateZoneState(zone.id, {
        ...zone.state,
        last_target_position: seeded,
        last_reported_position: seeded,
      });
    }
  }
}

export interface ControlLoopHandle {
  stop(): void;
}

/**
 * Self-rescheduling setTimeout, not setInterval — a tick is only ever
 * scheduled after the previous one settles, so an overrunning tick can
 * never stack a second, concurrent one against the same vents. A ~45s
 * (configurable) watchdog stops *waiting* on a wedged tick and reschedules
 * regardless, logging at error, since a controller that silently stops
 * ticking is the single worst failure mode here — see "Loop mechanism".
 *
 * The watchdog gives up waiting, it doesn't cancel the wedged cycle's own
 * in-flight work (JS has no preemptive cancellation without an
 * AbortSignal threaded through every Flair/DB call, which this pass
 * doesn't add) — a wedged cycle's Flair calls/DB writes may still settle
 * in the background after the next cycle has already started. In the
 * common, non-wedged case this never matters, since reschedule only
 * happens after real completion; it's a documented, narrow exception for
 * the abnormal case, not silent.
 */
export function startControlLoop(): ControlLoopHandle {
  if (!isControlLoopEnabled()) {
    log.warn("CONTROL_LOOP_ENABLED=false — control loop will not start");
    return { stop() {} };
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function runOneCycle(): Promise<number> {
    const installation = await getOrCreateDefaultInstallation();
    const settings = await getSystemSettings(installation.id);
    const intervalMs = settings.control_tick_interval_seconds * 1000;
    const watchdogMs = settings.tick_watchdog_seconds * 1000;

    let timedOut = false;
    const watchdog = new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, watchdogMs);
    });

    await Promise.race([runAllHandlers(), watchdog]);
    if (timedOut) {
      log.error(
        { watchdog_seconds: settings.tick_watchdog_seconds },
        "Control loop tick exceeded watchdog timeout — rescheduling regardless",
      );
    }
    return intervalMs;
  }

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(runLoop, delayMs);
  };

  async function runLoop() {
    let nextIntervalMs = 60_000;
    try {
      nextIntervalMs = await runOneCycle();
    } catch (err) {
      log.error({ err }, "Control loop cycle failed — rescheduling anyway");
    }
    scheduleNext(nextIntervalMs);
  }

  scheduleNext(0);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
