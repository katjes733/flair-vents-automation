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
import { patchVentState } from "~/shared/types/zone";
import { createRedisReconciliationQueue } from "~/server/control/reconciliationQueue";
import { createRedisSpikeBufferStore } from "~/server/control/spikeBuffer";
import { createRedisAirHandlerRuntimeStore } from "~/server/control/airHandlerRuntimeStore";
import { createRedisZoneDemandTrackingStore } from "~/server/control/zoneDemandTrackingStore";
import { createRedisAlertingClient } from "~/server/util/alerting";
import {
  getTokenCallsToday,
  FLAIR_TOKEN_DAILY_BUDGET,
} from "~/server/util/flair/tokenBudget";
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

// One FlairClient per installation, reused across cycles — not recreated
// per tick. This matters beyond avoiding waste: FlairApiClient's outage
// tracker (see util/flair/outage.ts) holds its "currently failing since
// <time>" state purely in memory, specifically so it logs a transition
// exactly once rather than once per failed tick. A fresh client every
// cycle would reset that state every cycle too, silently defeating both
// the once-per-transition logging and any outage-duration tracking.
const clientsByInstallation = new Map<string, FlairApiClient>();
// Exported so routes/sync.ts (a one-off, user-triggered Flair fetch, not
// a tick) shares the same per-installation client/outage-tracker rather
// than constructing a second one with its own independent state.
export function getFlairClient(installationId: string): FlairApiClient {
  let client = clientsByInstallation.get(installationId);
  if (!client) {
    client = new FlairApiClient(installationId);
    clientsByInstallation.set(installationId, client);
  }
  return client;
}

/**
 * Runs one full cycle — every active air handler on the one configured
 * installation, sequentially, sharing a single FlairClient (and therefore
 * a single OAuth token / rate-limit budget) across all of them, per "Loop
 * mechanism": more air handlers under the same account is a within-tick
 * concern, not a horizontal-scaling one.
 */
// Coalesces every caller of a tick cycle — the scheduled loop below and
// any explicit `triggerImmediateTick()` call (e.g. right after a Sync
// Engine import, so a newly-added zone shows a real reading immediately
// instead of waiting up to a full tick interval) — onto the SAME in-flight
// `runAllHandlers()` promise, so two cycles can never run concurrently
// against the same vents. A caller that arrives while a cycle is already
// running simply awaits that cycle's own completion rather than starting
// a second, overlapping one.
let inFlightCycle: Promise<void> | null = null;

function runAllHandlersCoalesced(): Promise<void> {
  if (!inFlightCycle) {
    inFlightCycle = runAllHandlers().finally(() => {
      inFlightCycle = null;
    });
  }
  return inFlightCycle;
}

/**
 * An explicit, user-triggered "tick now" — not part of the recurring
 * schedule, so it runs regardless of `CONTROL_LOOP_ENABLED` (a distinct
 * concern: disabling the background loop, not disabling ticking
 * altogether). Every real-hardware safety gate (`DRY_RUN`,
 * `live_air_handler_ids`, `control_disarmed`) still applies exactly as it
 * does on a scheduled tick, since this runs the identical `runAllHandlers`
 * path — this only changes *when* a cycle runs, never *what* it's allowed
 * to do once it does.
 */
export async function triggerImmediateTick(): Promise<void> {
  await runAllHandlersCoalesced();
}

export async function runAllHandlers(): Promise<void> {
  const installation = await getOrCreateDefaultInstallation();
  if (!installation.flairStructureId) {
    log.debug("No Flair structure linked yet — skipping this cycle");
    return;
  }

  const settings = await getSystemSettings(installation.id);
  const schedules = await getSchedulesForInstallation(installation.id);
  const airHandlers = await getActiveAirHandlers(installation.id);
  const client = getFlairClient(installation.id);
  const reconciliationQueue = createRedisReconciliationQueue();
  const spikeBufferStore = createRedisSpikeBufferStore();
  const airHandlerRuntimeStore = createRedisAirHandlerRuntimeStore();
  const zoneDemandTrackingStore = createRedisZoneDemandTrackingStore();
  const alerting = createRedisAlertingClient();
  const globalDryRun = isDryRunEnv();

  // Token budget — a per-installation concern (one shared Flair OAuth
  // client), checked once per cycle here rather than once per air
  // handler inside runTick(), which would just redundantly dedup N times.
  const tokenBudgetAlertKey = `alert:tokenBudget:${installation.id}`;
  const callsToday = await getTokenCallsToday();
  const budgetUsedPct = (callsToday / FLAIR_TOKEN_DAILY_BUDGET) * 100;
  if (budgetUsedPct >= settings.token_budget_alert_threshold_pct) {
    await alerting.alertOnce({
      key: tokenBudgetAlertKey,
      subject: "Flair token budget approaching daily limit",
      text: `${callsToday} of the ~${FLAIR_TOKEN_DAILY_BUDGET}/day Flair token-endpoint budget have been used today (${Math.round(budgetUsedPct)}%) — if this is unexpected, check for a retry storm or more than one environment sharing this Flair account.`,
      rateFloorMinutes: settings.email_rate_floor_minutes,
    });
  } else {
    await alerting.clearAlert(tokenBudgetAlertKey);
  }

  // Extended Flair outage — client.getOutageState() polled once per
  // cycle rather than the outage tracker alerting itself, keeping
  // client.ts a pure state tracker (per outage.ts's own design) and the
  // alert decision (needs the current settings threshold) in the
  // orchestration layer that already has them.
  const outageAlertKey = `alert:flairOutage:${installation.id}`;
  const outageState = client.getOutageState();
  if (outageState.failing && outageState.sinceMs !== null) {
    const outageMinutes = (Date.now() - outageState.sinceMs) / 60000;
    if (outageMinutes >= settings.flair_outage_alert_minutes) {
      await alerting.alertOnce({
        key: outageAlertKey,
        subject: "Extended Flair outage",
        text: `Flair API requests have been failing for over ${settings.flair_outage_alert_minutes} minute(s) — vents are holding their last commanded position until this clears.`,
        rateFloorMinutes: settings.email_rate_floor_minutes,
      });
    }
  } else {
    await alerting.clearAlert(outageAlertKey);
  }

  // Flair OAuth refresh failure — a terminal failure (the grant itself is
  // invalid) alerts immediately, per "distinguished at the first attempt,
  // not after accumulating retries." A transient failure (network/5xx/
  // rate-limit) is folded into the same alert here rather than the
  // plan's fuller resync-and-retry-once escalation path, which isn't
  // built — a known, simpler stand-in, not silently pretended otherwise.
  const refreshFailureAlertKey = `alert:flairTokenRefreshFailed:${installation.id}`;
  const refreshFailure = client.getTokenRefreshFailureState();
  if (refreshFailure) {
    await alerting.alertOnce({
      key: refreshFailureAlertKey,
      subject: "Flair token refresh failed",
      text: `${refreshFailure.message}${refreshFailure.terminal ? " — this looks terminal (the grant itself is invalid) and likely needs re-authentication." : " — a transient failure; will keep retrying on the normal schedule."}`,
      rateFloorMinutes: settings.email_rate_floor_minutes,
    });
  } else {
    await alerting.clearAlert(refreshFailureAlertKey);
  }

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
      zoneDemandTrackingStore,
      alerting,
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
  const client = getFlairClient(installation.id);
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

    const zoneInputs = controllableZones.map((zone) => ({
      zoneId: zone.id,
      vents: zone.config.flair_vents.map(({ flair_vent_id: flairVentId }) => ({
        flairVentId,
        reportedPosition:
          snapshot.ventsById.get(flairVentId)?.percentOpen ?? null,
      })),
      lastTargetPosition: zone.state.last_target_position,
      minStepDeltaPct: settings.min_step_delta_pct,
    }));

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
      let vents = zone.state.vents;
      for (const { flair_vent_id: flairVentId } of zone.config.flair_vents) {
        const reportedPosition =
          snapshot.ventsById.get(flairVentId)?.percentOpen ?? null;
        vents = patchVentState(vents, flairVentId, {
          last_reported_position: reportedPosition,
        });
      }
      await updateZoneState(zone.id, {
        ...zone.state,
        last_target_position: seeded,
        vents,
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

    await Promise.race([runAllHandlersCoalesced(), watchdog]);
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
