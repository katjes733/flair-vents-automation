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
import { getSystemSettings } from "~/server/util/routes/systemSettings";
import { isChronicallyMisaligned } from "~/server/domain/sensors/ventMisalignment";
import {
  createZoneForInstallation,
  updateZoneWithValidation,
  deleteZoneWithValidation,
} from "~/server/util/services/zoneService";
import type { ZoneData } from "~/server/util/routes/zone";
import type { SystemSettingsConfig } from "~/shared/schemas/systemSettings";

export const router = express.Router();

router.use(resolveActorMiddleware);

// Server-computed, never persisted — see
// vent_misalignment_chronic_threshold_count's own comment
// (systemSettings.ts). Attached fresh every time a zone is served so it's
// correct even without a recent tick decision, with nothing to keep in
// sync beyond the same recalibration history the tick loop already
// maintains.
function withVentMisalignmentChronic(
  zone: ZoneData,
  settings: SystemSettingsConfig,
  nowMs: number,
) {
  return {
    ...zone,
    ventMisalignmentChronic: isChronicallyMisaligned({
      recalibrationHistoryMs:
        zone.state.vent_misalignment_recalibration_history.map((iso) =>
          new Date(iso).getTime(),
        ),
      nowMs,
      windowMs: settings.vent_misalignment_chronic_window_hours * 3600000,
      thresholdCount: settings.vent_misalignment_chronic_threshold_count,
    }),
  };
}

router.get("/", async (req, res) => {
  const [zones, settings] = await Promise.all([
    getZonesForInstallation(req.actor!.installationId),
    getSystemSettings(req.actor!.installationId),
  ]);
  const nowMs = Date.now();
  res
    .status(200)
    .json(zones.map((z) => withVentMisalignmentChronic(z, settings, nowMs)));
});

router.get("/:id", async (req, res) => {
  const zone = await getZoneById(req.params.id);
  // A column-level FK guarantees the row *exists*, not that it belongs to
  // the *caller's* installation — 404 (not 403) so a cross-tenant guess
  // can't be distinguished from a genuinely unknown id.
  if (!zone || zone.installationId !== req.actor!.installationId) {
    throw new HttpError(`Zone ${req.params.id} not found.`, 404);
  }
  const settings = await getSystemSettings(req.actor!.installationId);
  res.status(200).json(withVentMisalignmentChronic(zone, settings, Date.now()));
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
