import { detectDrift } from "~/server/domain/dispatch/stepDelta";
import type { ReconciliationQueue } from "~/server/control/reconciliationQueue";
import { logStartupReconciliationCompleted } from "~/server/logEvents";

type Logger = ReturnType<typeof logger.child>;

export interface StartupReconciliationResult {
  seedLastCommandedTarget: Map<string, number>;
  mismatches: string[];
}

/**
 * Seeds the ramp origin from reality (so the first ramp starts from where
 * vents actually are), and compares each vent's reported position against
 * its *persisted pre-restart* last_target_position — a genuine mismatch
 * enters the normal retry/degrade path exactly as a live reconciliation
 * failure would, per "Reconciliation & startup reconciliation": seeding
 * the ramp origin from reality is not the same as accepting reality as
 * correct.
 */
export function computeStartupReconciliation(
  zones: Array<{
    zoneId: string;
    reportedPosition: number | null;
    lastTargetPosition: number | null;
    minStepDeltaPct: number;
  }>,
): StartupReconciliationResult {
  const seedLastCommandedTarget = new Map<string, number>();
  const mismatches: string[] = [];

  for (const zone of zones) {
    if (zone.reportedPosition === null) continue;
    seedLastCommandedTarget.set(zone.zoneId, zone.reportedPosition);
    if (
      zone.lastTargetPosition !== null &&
      detectDrift({
        reportedPosition: zone.reportedPosition,
        lastTargetPosition: zone.lastTargetPosition,
        minStepDeltaPct: zone.minStepDeltaPct,
      })
    ) {
      mismatches.push(zone.zoneId);
    }
  }

  return { seedLastCommandedTarget, mismatches };
}

export async function runStartupReconciliation(params: {
  log: Logger;
  airHandlerId: string;
  zones: Array<{
    zoneId: string;
    reportedPosition: number | null;
    lastTargetPosition: number | null;
    minStepDeltaPct: number;
  }>;
  reconciliationQueue: ReconciliationQueue;
  nowMs: number;
}): Promise<StartupReconciliationResult> {
  const result = computeStartupReconciliation(params.zones);
  await Promise.all(
    result.mismatches.map((zoneId) =>
      params.reconciliationQueue.enqueue(zoneId, params.nowMs),
    ),
  );
  logStartupReconciliationCompleted(params.log, {
    air_handler_id: params.airHandlerId,
    vents_checked: params.zones.length,
    mismatches_found: result.mismatches.length,
  });
  return result;
}
