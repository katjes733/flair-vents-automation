import { randomUUID } from "crypto";
import { HttpError } from "~/server/util/httpError";
import { validatePriorityOrder } from "~/server/domain/config/validateConfig";
import { getZonesForInstallation } from "~/server/util/routes/zone";
import {
  createSchedule,
  updateSchedule,
  deleteSchedule,
  getScheduleById,
  type ScheduleData,
} from "~/server/util/routes/schedule";
import type {
  ScheduleEvent,
  ScheduleConfig,
} from "~/shared/schemas/scheduleEvents";
import type { ScheduleEventRequest } from "~/shared/schemas/scheduleRequest";

/**
 * Fills in id/created_at for a brand-new event and always bumps
 * modified_at to now for whatever's submitted — an edit is exactly what
 * "this event was part of the request" means here, and the overlap
 * tiebreak needs modified_at to reflect that. `existingById` supplies the
 * original created_at for an event whose id already existed.
 */
function normalizeEvents(
  requestedEvents: ScheduleEventRequest[],
  existingById: Map<string, ScheduleEvent>,
  nowIso: string,
): ScheduleEvent[] {
  return requestedEvents.map((event) => {
    const existing = event.id ? existingById.get(event.id) : undefined;
    return {
      ...event,
      id: event.id ?? randomUUID(),
      created_at: existing?.created_at ?? nowIso,
      modified_at: nowIso,
    };
  });
}

/**
 * Every zone id an event references (zone_settings, zone_priority_order,
 * driving_zone_overrides) must exist and belong to the *same*
 * installation — a column-level FK can't enforce this at all here, since
 * these ids live inside a JSONB array, not a real foreign key. See
 * "Multi-tenancy" / Data Model's referential-integrity note for schedules.
 */
async function assertReferencedZonesValid(
  installationId: string,
  events: ScheduleEvent[],
): Promise<void> {
  const zones = await getZonesForInstallation(installationId);
  const knownZoneIds = new Set(zones.map((z) => z.id));

  for (const event of events) {
    for (const row of event.zone_settings) {
      if (!knownZoneIds.has(row.zone_id)) {
        throw new HttpError(
          `zone_settings references unknown or cross-installation zone ${row.zone_id}.`,
          400,
        );
      }
      // "Required for an active event, meaningless for inactive ones" —
      // see zoneScheduleSettingSchema's own comment; a cross-field rule
      // Zod alone can't express, so it's enforced here at save time.
      if (
        event.mode === "active" &&
        (row.cool_setpoint === undefined || row.heat_setpoint === undefined)
      ) {
        throw new HttpError(
          `Zone ${row.zone_id} is missing cool_setpoint/heat_setpoint, required for an active event.`,
          400,
        );
      }
    }
    if (event.zone_priority_order) {
      const issues = validatePriorityOrder(
        event.zone_priority_order,
        knownZoneIds,
      ).filter((i) => i.severity === "error");
      if (issues.length > 0) {
        throw new HttpError(issues.map((i) => i.message).join(" "), 400);
      }
    }
    for (const zoneId of Object.values(event.driving_zone_overrides ?? {})) {
      if (!knownZoneIds.has(zoneId)) {
        throw new HttpError(
          `driving_zone_overrides references unknown or cross-installation zone ${zoneId}.`,
          400,
        );
      }
    }
  }
}

export async function createScheduleForInstallation(params: {
  installationId: string;
  name: string;
  events: ScheduleEventRequest[];
  config: ScheduleConfig;
}): Promise<ScheduleData> {
  const events = normalizeEvents(
    params.events,
    new Map(),
    new Date().toISOString(),
  );
  await assertReferencedZonesValid(params.installationId, events);
  return createSchedule({ ...params, events });
}

export async function updateScheduleWithValidation(
  scheduleId: string,
  patch: Partial<{
    name: string;
    events: ScheduleEventRequest[];
    config: Partial<ScheduleConfig>;
  }>,
): Promise<ScheduleData> {
  const existing = await getScheduleById(scheduleId);
  if (!existing) {
    throw new HttpError(`Schedule ${scheduleId} not found.`, 404);
  }
  const existingById = new Map(existing.events.map((e) => [e.id, e]));
  const mergedEvents = patch.events
    ? normalizeEvents(patch.events, existingById, new Date().toISOString())
    : existing.events;
  await assertReferencedZonesValid(existing.installationId, mergedEvents);
  await updateSchedule(scheduleId, {
    ...(patch.name !== undefined && { name: patch.name }),
    events: mergedEvents,
    config: { ...existing.config, ...patch.config },
  });
  const updated = await getScheduleById(scheduleId);
  return updated!;
}

export async function deleteScheduleWithValidation(
  scheduleId: string,
): Promise<void> {
  const existing = await getScheduleById(scheduleId);
  if (!existing) {
    throw new HttpError(`Schedule ${scheduleId} not found.`, 404);
  }
  await deleteSchedule(scheduleId);
}
