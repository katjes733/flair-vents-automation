import { HttpError } from "~/server/util/httpError";
import { validateZoneConfig } from "~/server/domain/config/validateConfig";
import { getAirHandlerById } from "~/server/util/routes/airHandler";
import {
  createZone,
  updateZone,
  deleteZone,
  getZoneById,
  getZonesForInstallation,
  type ZoneData,
} from "~/server/util/routes/zone";
import { getSchedulesForInstallation } from "~/server/util/routes/schedule";
import type { VentHardwareType, ZoneConfig } from "~/shared/schemas/zoneConfig";

/**
 * A column-level FK on air_handler_id guarantees the referenced row
 * *exists*, not that it belongs to the *same installation* as the zone
 * being saved — this is the one extra check per "Multi-tenancy" that
 * closes that gap. Only one installation exists today, so this can't
 * actually fire yet, but the check is real, not a placeholder for later.
 */
async function assertSameInstallationAirHandler(
  installationId: string,
  airHandlerId: string,
): Promise<void> {
  const airHandler = await getAirHandlerById(airHandlerId);
  if (!airHandler) {
    throw new HttpError(`air_handler_id ${airHandlerId} does not exist.`, 400);
  }
  if (airHandler.installationId !== installationId) {
    throw new HttpError(
      `air_handler_id ${airHandlerId} belongs to a different installation.`,
      400,
    );
  }
}

function assertNoConfigIssues(zone: {
  ventHardwareType: VentHardwareType;
  flairRoomId: string | null;
  config: ZoneConfig;
}): void {
  const issues = validateZoneConfig({
    ventHardwareType: zone.ventHardwareType,
    flairRoomId: zone.flairRoomId,
    flairVentIds: zone.config.flair_vent_ids,
    assumedFixedPosition: zone.config.assumed_fixed_position,
    minVentPosition: zone.config.min_vent_position,
    maxVentPosition: zone.config.max_vent_position,
    idleBaselinePosition: zone.config.idle_baseline_position,
  }).filter((i) => i.severity === "error");
  if (issues.length > 0) {
    throw new HttpError(issues.map((i) => i.message).join(" "), 400);
  }
}

/**
 * A column-level constraint can't express "no two zones share a Flair vent
 * id" (they're JSONB array members, not a column) — this is the app-level
 * equivalent of `flair_room_id`'s DB-enforced uniqueness, per "Multi-Vent
 * Zones". `excludeZoneId` lets an update check against every *other* zone
 * without tripping on its own already-assigned vent ids.
 */
async function assertNoVentIdConflict(
  installationId: string,
  flairVentIds: string[],
  excludeZoneId?: string,
): Promise<void> {
  if (flairVentIds.length === 0) return;
  const zones = await getZonesForInstallation(installationId);
  for (const other of zones) {
    if (other.id === excludeZoneId) continue;
    const conflict = other.config.flair_vent_ids.find((id) =>
      flairVentIds.includes(id),
    );
    if (conflict) {
      throw new HttpError(
        `flair_vent_id ${conflict} is already assigned to zone "${other.name}".`,
        400,
      );
    }
  }
}

export async function createZoneForInstallation(params: {
  installationId: string;
  airHandlerId: string;
  flairRoomId: string | null;
  name: string;
  ventHardwareType: VentHardwareType;
  config: ZoneConfig;
}): Promise<ZoneData> {
  await assertSameInstallationAirHandler(
    params.installationId,
    params.airHandlerId,
  );
  assertNoConfigIssues(params);
  await assertNoVentIdConflict(
    params.installationId,
    params.config.flair_vent_ids,
  );
  return createZone(params);
}

export async function updateZoneWithValidation(
  zoneId: string,
  patch: Partial<{
    airHandlerId: string;
    name: string;
    ventHardwareType: VentHardwareType;
    flairRoomId: string | null;
    config: Partial<ZoneConfig>;
  }>,
): Promise<ZoneData> {
  const existing = await getZoneById(zoneId);
  if (!existing) {
    throw new HttpError(`Zone ${zoneId} not found.`, 404);
  }
  if (patch.airHandlerId !== undefined) {
    await assertSameInstallationAirHandler(
      existing.installationId,
      patch.airHandlerId,
    );
  }
  // config is a merge onto the existing row, not a full replacement — the
  // request schema only requires the fields actually being changed.
  const mergedConfig: ZoneConfig = { ...existing.config, ...patch.config };
  assertNoConfigIssues({
    ventHardwareType: patch.ventHardwareType ?? existing.ventHardwareType,
    // Validated against the *patched* value — previously always the
    // existing row's flairRoomId, which was correct only because nothing
    // ever patched it. Sync (see "Flair Sync Engine") is the first real
    // caller that does.
    flairRoomId: patch.flairRoomId ?? existing.flairRoomId,
    config: mergedConfig,
  });
  await assertNoVentIdConflict(
    existing.installationId,
    mergedConfig.flair_vent_ids,
    zoneId,
  );
  await updateZone(zoneId, {
    ...(patch.airHandlerId !== undefined && {
      airHandlerId: patch.airHandlerId,
    }),
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.ventHardwareType !== undefined && {
      ventHardwareType: patch.ventHardwareType,
    }),
    ...(patch.flairRoomId !== undefined && {
      flairRoomId: patch.flairRoomId,
    }),
    config: mergedConfig,
  });
  const updated = await getZoneById(zoneId);
  return updated!;
}

/**
 * Refused, not silently pruned, if a schedule still references this zone
 * — per Data Model / schedules: "silently dropping a zone from a
 * night-time priority order is exactly the kind of change nobody notices
 * until a bedroom is uncomfortable."
 */
export async function deleteZoneWithValidation(zoneId: string): Promise<void> {
  const existing = await getZoneById(zoneId);
  if (!existing) {
    throw new HttpError(`Zone ${zoneId} not found.`, 404);
  }
  const schedules = await getSchedulesForInstallation(existing.installationId);
  const referencing = schedules.filter(
    (s) =>
      s.events.some((e) =>
        e.zone_settings.some((row) => row.zone_id === zoneId),
      ) ||
      s.events.some((e) => e.zone_priority_order?.includes(zoneId)) ||
      s.events.some((e) =>
        Object.values(e.driving_zone_overrides ?? {}).includes(zoneId),
      ),
  );
  if (referencing.length > 0) {
    throw new HttpError(
      `Cannot delete zone ${zoneId} — referenced by schedule(s): ${referencing.map((s) => s.name).join(", ")}.`,
      409,
    );
  }
  await deleteZone(zoneId);
}
