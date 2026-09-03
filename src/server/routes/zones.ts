import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { HttpError } from "~/server/util/httpError";
import {
  createZoneRequestSchema,
  updateZoneRequestSchema,
  type CreateZoneRequest,
  type UpdateZoneRequest,
} from "~/shared/schemas/zoneRequest";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
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

router.get("/", async (_req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  const zones = await getZonesForInstallation(installation.id);
  res.status(200).json(zones);
});

router.get("/:id", async (req, res) => {
  const zone = await getZoneById(req.params.id);
  if (!zone) throw new HttpError(`Zone ${req.params.id} not found.`, 404);
  res.status(200).json(zone);
});

router.post("/", validateBody(createZoneRequestSchema), async (req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  const body = req.body as CreateZoneRequest;
  const zone = await createZoneForInstallation({
    installationId: installation.id,
    airHandlerId: body.air_handler_id,
    flairRoomId: body.flair_room_id,
    name: body.name,
    ventHardwareType: body.vent_hardware_type,
    config: body.config,
  });
  res.status(201).json(zone);
});

router.patch(
  "/:id",
  validateBody(updateZoneRequestSchema),
  async (req, res) => {
    const body = req.body as UpdateZoneRequest;
    const zone = await updateZoneWithValidation(req.params.id as string, {
      airHandlerId: body.air_handler_id,
      name: body.name,
      ventHardwareType: body.vent_hardware_type,
      config: body.config,
    });
    res.status(200).json(zone);
  },
);

router.delete("/:id", async (req, res) => {
  await deleteZoneWithValidation(req.params.id);
  res.status(204).send();
});
