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
  return { config: merged, warnings };
}
