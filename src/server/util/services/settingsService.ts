import {
  validateStepDeltaRelationship,
  validateSleepModeStepDelta,
  validatePriorityOrder,
} from "~/server/domain/config/validateConfig";
import { HttpError } from "~/server/util/httpError";
import {
  getSystemSettings,
  updateSystemSettings,
} from "~/server/util/routes/systemSettings";
import { getZonesForInstallation } from "~/server/util/routes/zone";
import { redis } from "~/server/util/redis";
import type { SystemSettingsConfig } from "~/shared/schemas/systemSettings";

export interface SettingsUpdateResult {
  config: SystemSettingsConfig;
  warnings: string[];
}

/**
 * Merges the patch onto the existing config (every field already has a
 * Zod default, so a partial update is well-formed the moment it's merged)
 * and surfaces the plan's own named warning-not-error checks — a
 * misconfigured relationship between settings is real to know about, but
 * none of these should block a save the way a genuine validation error
 * does elsewhere.
 */
export async function updateSettingsForInstallation(
  installationId: string,
  patch: Partial<SystemSettingsConfig>,
): Promise<SettingsUpdateResult> {
  const existing = await getSystemSettings(installationId);
  const merged: SystemSettingsConfig = { ...existing, ...patch };

  const warnings: string[] = [];
  warnings.push(
    ...validateStepDeltaRelationship({
      minStepDeltaPct: merged.min_step_delta_pct,
      modulationStepPct: merged.modulation_step_pct,
      maxStepsPerTick: merged.max_steps_per_tick,
    }).map((i) => i.message),
  );
  warnings.push(
    ...validateSleepModeStepDelta({
      minStepDeltaPct: merged.min_step_delta_pct,
      sleepModeMinStepDeltaPct: merged.sleep_mode_min_step_delta_pct,
    }).map((i) => i.message),
  );
  if (merged.zone_priority_order.length > 0) {
    const zones = await getZonesForInstallation(installationId);
    const priorityIssues = validatePriorityOrder(
      merged.zone_priority_order,
      new Set(zones.map((z) => z.id)),
    );
    const priorityErrors = priorityIssues.filter((i) => i.severity === "error");
    if (priorityErrors.length > 0) {
      throw new HttpError(priorityErrors.map((i) => i.message).join(" "), 400);
    }
    warnings.push(...priorityIssues.map((i) => i.message));
  }

  await updateSystemSettings(installationId, merged);

  // A newly-promoted air handler (added to live_air_handler_ids here,
  // absent from it before) is exactly the moment ramp state most needs to
  // be re-seeded from reality — see maybeSeedStartupReconciliation's own
  // comment. During a long shadow-mode run, "last dispatched position"
  // bookkeeping keeps advancing as if commands were succeeding (shadow
  // mode's own stated guarantee), so by promotion time it can be
  // completely decoupled from the vent's real physical position; the
  // step-delta suppressor then reads that phantom state as "no change
  // needed" and never actually corrects it. Clearing the flag here forces
  // a reseed on the very next tick instead of waiting out the timer-based
  // backstop — a real, confirmed incident this exact gap caused live, not
  // a hypothetical.
  const newlyPromoted = merged.live_air_handler_ids.filter(
    (id) => !existing.live_air_handler_ids.includes(id),
  );
  if (newlyPromoted.length > 0) {
    await redis.del(`recon:startupSeeded:${installationId}`);
  }

  return { config: merged, warnings };
}
