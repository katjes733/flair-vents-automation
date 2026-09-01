import { detectDrift } from "~/server/domain/dispatch/stepDelta";
import type { ReconciliationQueue } from "~/server/control/reconciliationQueue";
import { logStartupReconciliationCompleted } from "~/server/logEvents";

type Logger = ReturnType<typeof logger.child>;

export interface StartupReconciliationMismatch {
  zoneId: string;
  flairVentId: string;
}

export interface StartupReconciliationResult {
  // Zone-level (matches last_target_position's own zone-level scalar
  // scope) — seeded as the MINIMUM reported position across the zone's
  // vents, the same conservative "never overestimate open area" bias the
  // pressure safeguard already uses, since there's no single correct
  // value when two vents have already diverged at boot. See "Multi-Vent
  // Zones".
  seedLastCommandedTarget: Map<string, number>;
  mismatches: StartupReconciliationMismatch[];
}

/**
 * Seeds the ramp origin from reality (so the first ramp starts from where
 * vents actually are), and compares each vent's own reported position
 * against the zone's *persisted pre-restart* last_target_position — a
 * genuine mismatch enters the normal retry/degrade path exactly as a live
 * reconciliation failure would, per "Reconciliation & startup
 * reconciliation": seeding the ramp origin from reality is not the same
 * as accepting reality as correct. Per-vent, since two vents in the same
 * zone can have drifted independently before a restart.
 */
export function computeStartupReconciliation(
  zones: Array<{
    zoneId: string;
    vents: Array<{ flairVentId: string; reportedPosition: number | null }>;
    lastTargetPosition: number | null;
    minStepDeltaPct: number;
  }>,
): StartupReconciliationResult {
  const seedLastCommandedTarget = new Map<string, number>();
  const mismatches: StartupReconciliationMismatch[] = [];

  for (const zone of zones) {
    const reportedPositions = zone.vents
      .map((v) => v.reportedPosition)
      .filter((p): p is number => p !== null);
    if (reportedPositions.length > 0) {
      seedLastCommandedTarget.set(zone.zoneId, Math.min(...reportedPositions));
    }
    for (const vent of zone.vents) {
      if (vent.reportedPosition === null) continue;
      if (
        zone.lastTargetPosition !== null &&
        detectDrift({
          reportedPosition: vent.reportedPosition,
          lastTargetPosition: zone.lastTargetPosition,
          minStepDeltaPct: zone.minStepDeltaPct,
        })
      ) {
        mismatches.push({ zoneId: zone.zoneId, flairVentId: vent.flairVentId });
      }
    }
  }

  return { seedLastCommandedTarget, mismatches };
}

export async function runStartupReconciliation(params: {
  log: Logger;
  airHandlerId: string;
  zones: Array<{
    zoneId: string;
    vents: Array<{ flairVentId: string; reportedPosition: number | null }>;
    lastTargetPosition: number | null;
    minStepDeltaPct: number;
  }>;
  reconciliationQueue: ReconciliationQueue;
  nowMs: number;
}): Promise<StartupReconciliationResult> {
  const result = computeStartupReconciliation(params.zones);
  await Promise.all(
    result.mismatches.map((m) =>
      params.reconciliationQueue.enqueue(
        `${m.zoneId}:${m.flairVentId}`,
        params.nowMs,
      ),
    ),
  );
  const ventsChecked = params.zones.reduce((n, z) => n + z.vents.length, 0);
  logStartupReconciliationCompleted(params.log, {
    air_handler_id: params.airHandlerId,
    vents_checked: ventsChecked,
    mismatches_found: result.mismatches.length,
  });
  return result;
}
