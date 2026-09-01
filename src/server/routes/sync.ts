import express from "express";
import { z } from "zod";
import { validateBody } from "~/server/middleware/validateBody";
import { HttpError } from "~/server/util/httpError";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { getAirHandlerById } from "~/server/util/routes/airHandler";
import { getSystemSettings } from "~/server/util/routes/systemSettings";
import { createRedisAlertingClient } from "~/server/util/alerting";
import { getFlairClient } from "~/server/control/scheduler";
import { fetchSyncCandidates } from "~/server/util/flair/resources";
import {
  runSync,
  linkRoomToZone,
  createZoneFromRoom,
} from "~/server/util/services/syncService";

export const router = express.Router();

/**
 * Every sync route is scoped to one air handler (a Flair room's `zoneId`
 * is this app's air-handler concept) — resolves the installation's
 * structure id + the handler's Flair zone id once, shared by all three
 * endpoints below. See "Flair Sync Engine".
 */
async function resolveSyncScope(airHandlerId: string) {
  const airHandler = await getAirHandlerById(airHandlerId);
  if (!airHandler) {
    throw new HttpError(`Air handler ${airHandlerId} not found.`, 404);
  }
  if (!airHandler.flairZoneId) {
    throw new HttpError(
      `Air handler ${airHandlerId} has no Flair zone linked yet — nothing to sync.`,
      400,
    );
  }
  const installation = await getOrCreateDefaultInstallation();
  if (!installation.flairStructureId) {
    throw new HttpError(
      "No Flair structure linked yet — nothing to sync.",
      400,
    );
  }
  return {
    installationId: installation.id,
    airHandlerId,
    structureId: installation.flairStructureId,
    flairZoneId: airHandler.flairZoneId,
  };
}

router.post("/:airHandlerId/run", async (req, res) => {
  const scope = await resolveSyncScope(req.params.airHandlerId as string);
  const settings = await getSystemSettings(scope.installationId);
  const result = await runSync({
    ...scope,
    client: getFlairClient(scope.installationId),
    alerting: createRedisAlertingClient(),
    rateFloorMinutes: settings.email_rate_floor_minutes,
    nowMs: Date.now(),
  });
  res.status(200).json(result);
});

const linkRequestSchema = z.object({
  flair_room_id: z.string().min(1),
  zone_id: z.string().uuid(),
});

router.post(
  "/:airHandlerId/link",
  validateBody(linkRequestSchema),
  async (req, res) => {
    const scope = await resolveSyncScope(req.params.airHandlerId as string);
    const candidates = await fetchSyncCandidates(
      getFlairClient(scope.installationId),
      scope.structureId,
      scope.flairZoneId,
    );
    const room = candidates.find(
      (r) => r.flairRoomId === req.body.flair_room_id,
    );
    if (!room) {
      throw new HttpError(
        `Flair room ${req.body.flair_room_id} is not currently visible on this air handler.`,
        400,
      );
    }
    const zone = await linkRoomToZone({ zoneId: req.body.zone_id, room });
    res.status(200).json(zone);
  },
);

const createRequestSchema = z.object({
  flair_room_id: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
});

router.post(
  "/:airHandlerId/create",
  validateBody(createRequestSchema),
  async (req, res) => {
    const scope = await resolveSyncScope(req.params.airHandlerId as string);
    const candidates = await fetchSyncCandidates(
      getFlairClient(scope.installationId),
      scope.structureId,
      scope.flairZoneId,
    );
    const room = candidates.find(
      (r) => r.flairRoomId === req.body.flair_room_id,
    );
    if (!room) {
      throw new HttpError(
        `Flair room ${req.body.flair_room_id} is not currently visible on this air handler.`,
        400,
      );
    }
    const zone = await createZoneFromRoom({
      installationId: scope.installationId,
      airHandlerId: scope.airHandlerId,
      room,
      name: req.body.name,
    });
    res.status(201).json(zone);
  },
);
