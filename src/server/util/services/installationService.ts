import { HttpError } from "~/server/util/httpError";
import {
  setInstallationFlairStructureId,
  type InstallationData,
} from "~/server/util/routes/installation";
import type { FlairClient } from "~/server/util/flair/client";

/**
 * Linking an installation to its Flair structure was never actually wired
 * up anywhere — `setInstallationFlairStructureId` existed and was tested,
 * but nothing called it, so `flair_structure_id` stayed null forever and
 * every Flair-structure-scoped feature (the zone picker, sync) 400'd
 * looking like "no zones" rather than "never linked." Auto-links on first
 * use instead of requiring a separate manual setup step, since a real
 * Flair account has exactly one structure in the confirmed-live case this
 * app targets today (see "Flair OAuth Integration" / Phase 0 findings) —
 * multiple structures on one account isn't something to guess a mapping
 * for, so it's refused rather than silently picking one.
 */
export async function ensureFlairStructureLinked(
  installation: InstallationData,
  flairClient: FlairClient,
): Promise<InstallationData> {
  if (installation.flairStructureId) return installation;
  const structures = await flairClient.fetchStructures();
  if (structures.length === 0) {
    throw new HttpError("No Flair structures found on this account.", 400);
  }
  if (structures.length > 1) {
    throw new HttpError(
      "Multiple Flair structures found on this account — automatic linking isn't supported for more than one.",
      400,
    );
  }
  await setInstallationFlairStructureId(installation.id, structures[0].id);
  return { ...installation, flairStructureId: structures[0].id };
}
