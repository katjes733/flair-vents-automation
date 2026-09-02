import { HttpError } from "~/server/util/httpError";
import { validateAirHandlerConfig } from "~/server/domain/config/validateConfig";
import {
  createAirHandler,
  updateAirHandler,
  deleteAirHandler,
  getAirHandlerById,
  getAirHandlersForInstallation,
  type AirHandlerData,
} from "~/server/util/routes/airHandler";
import { getZonesForAirHandler } from "~/server/util/routes/zone";
import type { AirHandlerConfig } from "~/shared/schemas/airHandlerConfig";

/**
 * `flair_zone_id` is DB-unique, but a raw constraint violation is an ugly
 * 500 — this gives the same clean, named error the rest of this app's
 * referential checks already do (mirrors `zoneService.ts`'s
 * `assertNoVentIdConflict`). `excludeAirHandlerId` lets an update check
 * against every *other* air handler without tripping on its own already-
 * assigned zone id.
 */
async function assertNoFlairZoneConflict(
  installationId: string,
  flairZoneId: string | null,
  excludeAirHandlerId?: string,
): Promise<void> {
  if (!flairZoneId) return;
  const airHandlers = await getAirHandlersForInstallation(installationId);
  const conflict = airHandlers.find(
    (ah) => ah.id !== excludeAirHandlerId && ah.flairZoneId === flairZoneId,
  );
  if (conflict) {
    throw new HttpError(
      `Flair zone is already assigned to air handler "${conflict.name}".`,
      400,
    );
  }
}

/**
 * tonnage_tons is required before an air handler can be set active — the
 * pressure safeguard's universal baseline (see "Resolved Design
 * Decisions"). Checked here, at save time, rather than only at tick time,
 * so a misconfigured handler can't silently go live without it.
 */
function assertNoConfigIssues(fields: {
  active: boolean;
  config: AirHandlerConfig;
}): void {
  const issues = validateAirHandlerConfig({
    active: fields.active,
    tonnageTons: fields.config.tonnage_tons,
  }).filter((i) => i.severity === "error");
  if (issues.length > 0) {
    throw new HttpError(issues.map((i) => i.message).join(" "), 400);
  }
}

export async function createAirHandlerForInstallation(params: {
  installationId: string;
  flairZoneId: string | null;
  name: string;
  active: boolean;
  config: AirHandlerConfig;
}): Promise<AirHandlerData> {
  assertNoConfigIssues(params);
  await assertNoFlairZoneConflict(params.installationId, params.flairZoneId);
  return createAirHandler(params);
}

export async function updateAirHandlerWithValidation(
  id: string,
  patch: Partial<{
    flairZoneId: string | null;
    name: string;
    active: boolean;
    config: Partial<AirHandlerConfig>;
  }>,
): Promise<AirHandlerData> {
  const existing = await getAirHandlerById(id);
  if (!existing) {
    throw new HttpError(`Air handler ${id} not found.`, 404);
  }
  const mergedConfig: AirHandlerConfig = {
    ...existing.config,
    ...patch.config,
  };
  assertNoConfigIssues({
    active: patch.active ?? existing.active,
    config: mergedConfig,
  });
  if (patch.flairZoneId !== undefined) {
    await assertNoFlairZoneConflict(
      existing.installationId,
      patch.flairZoneId,
      id,
    );
  }
  await updateAirHandler(id, {
    ...(patch.flairZoneId !== undefined && { flairZoneId: patch.flairZoneId }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.active !== undefined && { active: patch.active }),
    config: mergedConfig,
  });
  const updated = await getAirHandlerById(id);
  return updated!;
}

/**
 * Refused, not silently cascaded, if any zone still belongs to this air
 * handler — mirrors `deleteZoneWithValidation`'s schedule-reference
 * refusal, and matches the FK's own `ON DELETE RESTRICT` (this check just
 * gives a clean, named error instead of a raw constraint violation).
 */
export async function deleteAirHandlerWithValidation(
  id: string,
): Promise<void> {
  const existing = await getAirHandlerById(id);
  if (!existing) {
    throw new HttpError(`Air handler ${id} not found.`, 404);
  }
  const zones = await getZonesForAirHandler(id);
  if (zones.length > 0) {
    throw new HttpError(
      `Cannot delete air handler "${existing.name}" — still has zone(s): ${zones.map((z) => z.name).join(", ")}.`,
      409,
    );
  }
  await deleteAirHandler(id);
}
