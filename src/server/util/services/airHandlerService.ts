import { HttpError } from "~/server/util/httpError";
import { validateAirHandlerConfig } from "~/server/domain/config/validateConfig";
import {
  createAirHandler,
  updateAirHandler,
  getAirHandlerById,
  type AirHandlerData,
} from "~/server/util/routes/airHandler";
import type { AirHandlerConfig } from "~/shared/schemas/airHandlerConfig";

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
  await updateAirHandler(id, {
    ...(patch.flairZoneId !== undefined && { flairZoneId: patch.flairZoneId }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.active !== undefined && { active: patch.active }),
    config: mergedConfig,
  });
  const updated = await getAirHandlerById(id);
  return updated!;
}
