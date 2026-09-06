import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { HttpError } from "~/server/util/httpError";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import {
  createZoneRequestSchema,
  updateZoneRequestSchema,
  type CreateZoneRequest,
  type UpdateZoneRequest,
} from "~/shared/schemas/zoneRequest";
import {
  getZonesForInstallation,
  getZoneById,
} from "~/server/util/routes/zone";
import {
  createZoneForInstallation,
  updateZoneWithValidation,
  deleteZoneWithValidation,
} from "~/server/util/services/zoneService";

export const router = express.Router();

router.use(resolveActorMiddleware);

router.get("/", async (req, res) => {
  const zones = await getZonesForInstallation(req.actor!.installationId);
  res.status(200).json(zones);
});

router.get("/:id", async (req, res) => {
  const zone = await getZoneById(req.params.id);
  // A column-level FK guarantees the row *exists*, not that it belongs to
  // the *caller's* installation — 404 (not 403) so a cross-tenant guess
  // can't be distinguished from a genuinely unknown id.
  if (!zone || zone.installationId !== req.actor!.installationId) {
    throw new HttpError(`Zone ${req.params.id} not found.`, 404);
  }
  res.status(200).json(zone);
});

router.post(
  "/",
  requirePermission("dashboard.zone.create"),
  validateBody(createZoneRequestSchema),
  async (req, res) => {
    const body = req.body as CreateZoneRequest;
    const zone = await createZoneForInstallation({
      installationId: req.actor!.installationId,
      airHandlerId: body.air_handler_id,
      flairRoomId: body.flair_room_id,
      name: body.name,
      ventHardwareType: body.vent_hardware_type,
      config: body.config,
    });
    res.status(201).json(zone);
  },
);

router.patch(
  "/:id",
  requirePermission("dashboard.zone.edit"),
  validateBody(updateZoneRequestSchema),
  async (req, res) => {
    const body = req.body as UpdateZoneRequest;
    const zone = await updateZoneWithValidation(
      req.actor!.installationId,
      req.params.id as string,
      {
        airHandlerId: body.air_handler_id,
        name: body.name,
        ventHardwareType: body.vent_hardware_type,
        config: body.config,
      },
    );
    res.status(200).json(zone);
  },
);

router.delete(
  "/:id",
  requirePermission("dashboard.zone.delete"),
  async (req, res) => {
    await deleteZoneWithValidation(
      req.actor!.installationId,
      req.params.id as string,
    );
    res.status(204).send();
  },
);
