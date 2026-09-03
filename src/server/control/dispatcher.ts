import type { FlairClient } from "~/server/util/flair/client";
import { dispatchVentPosition } from "~/server/util/flair/commands";
import { shouldDispatch } from "~/server/domain/dispatch/stepDelta";
import type { ReconciliationQueue } from "~/server/control/reconciliationQueue";
import {
  logVentCommandDispatched,
  logVentCommandSuppressed,
} from "~/server/logEvents";

type Logger = ReturnType<typeof logger.child>;

export interface DispatchResult {
  dispatched: boolean;
  lastDispatchedPosition: number | null;
}

/**
 * Applies the step-delta suppressor, then dispatches (unless `dryRun`) and
 * enqueues a reconciliation check. `dry_run` is a field on the log event
 * regardless of whether the suppressor itself fired, per "Shadow mode":
 * the decision is logged the same way whether or not it was acted on.
 */
export async function dispatchZoneCommand(params: {
  log: Logger;
  client: FlairClient;
  airHandlerId: string;
  zoneId: string;
  ventId: string;
  targetPosition: number;
  lastDispatchedPosition: number | null;
  reportedPosition: number | null;
  minStepDeltaPct: number;
  reconciliationQueue: ReconciliationQueue;
  nowMs: number;
  actuationDelayMs: number;
  dryRun: boolean;
}): Promise<DispatchResult> {
  const stepDeltaPct =
    params.lastDispatchedPosition === null
      ? params.targetPosition
      : Math.abs(params.targetPosition - params.lastDispatchedPosition);

  const decision = shouldDispatch({
    targetPosition: params.targetPosition,
    lastDispatchedPosition: params.lastDispatchedPosition,
    minStepDeltaPct: params.minStepDeltaPct,
  });

  if (!decision) {
    logVentCommandSuppressed(params.log, {
      air_handler_id: params.airHandlerId,
      zone_id: params.zoneId,
      vent_id: params.ventId,
      target_pct: params.targetPosition,
      last_dispatched_pct: params.lastDispatchedPosition,
      step_delta_pct: stepDeltaPct,
    });
    return {
      dispatched: false,
      lastDispatchedPosition: params.lastDispatchedPosition,
    };
  }

  if (!params.dryRun) {
    await dispatchVentPosition(
      params.client,
      params.ventId,
      params.targetPosition,
    );
    // Compound key — see "Multi-Vent Zones": two vents in the same zone
    // must reconcile independently, and a shared zoneId-only key would
    // silently coalesce the second vent's pending reconciliation into the
    // first's (ZADD/Map.set semantics).
    await params.reconciliationQueue.enqueue(
      `${params.zoneId}:${params.ventId}`,
      params.nowMs + params.actuationDelayMs,
    );
  }

  logVentCommandDispatched(params.log, {
    air_handler_id: params.airHandlerId,
    zone_id: params.zoneId,
    vent_id: params.ventId,
    target_pct: params.targetPosition,
    reported_pct: params.reportedPosition,
    step_delta_pct: stepDeltaPct,
    dry_run: params.dryRun,
  });

  return { dispatched: true, lastDispatchedPosition: params.targetPosition };
}
