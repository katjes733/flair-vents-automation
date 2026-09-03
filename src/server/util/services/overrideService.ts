import { HttpError } from "~/server/util/httpError";
import {
  computeOverrideExpiry,
  findNextEventBoundary,
} from "~/server/domain/targets/manualOverride";
import { resolveManualOverrideConfig } from "~/shared/schemas/manualOverride";
import type { CreateManualOverrideRequest } from "~/shared/schemas/manualOverrideRequest";
import { getZoneById } from "~/server/util/routes/zone";
import { getSchedulesForInstallation } from "~/server/util/routes/schedule";
import { getSystemSettings } from "~/server/util/routes/systemSettings";
import {
  createManualOverride,
  revokeManualOverride,
  getLatestOverridesForZones,
  type ManualOverrideRow,
} from "~/server/util/routes/manualOverride";

export async function createOverrideForZone(
  body: CreateManualOverrideRequest,
): Promise<ManualOverrideRow> {
  const zone = await getZoneById(body.zone_id);
  if (!zone) {
    throw new HttpError(`Zone ${body.zone_id} not found.`, 404);
  }

  const nowMs = Date.now();
  let expiresAtMs: number | null;
  if (body.hold_type === "until_next_event") {
    const settings = await getSystemSettings(zone.installationId);
    const schedules = await getSchedulesForInstallation(zone.installationId);
    const events = schedules.flatMap((s) =>
      s.events.filter((e) =>
        e.zone_settings.some((row) => row.zone_id === zone.id),
      ),
    );
    expiresAtMs = findNextEventBoundary(events, nowMs, settings.home_timezone);
  } else {
    expiresAtMs = computeOverrideExpiry(body.hold_type, nowMs, null);
  }

  const config = resolveManualOverrideConfig({
    kind: body.kind,
    value: body.value,
    hold_type: body.hold_type,
    actor: body.actor,
    note: body.note,
  });

  return createManualOverride({
    installationId: zone.installationId,
    zoneId: zone.id,
    config,
    expiresAtMs,
  });
}

export async function revokeOverride(id: string): Promise<void> {
  await revokeManualOverride(id);
}

export { getLatestOverridesForZones };
