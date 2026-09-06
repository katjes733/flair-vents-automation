import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { HttpError } from "~/server/util/httpError";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import {
  createScheduleRequestSchema,
  updateScheduleRequestSchema,
  type CreateScheduleRequest,
  type UpdateScheduleRequest,
} from "~/shared/schemas/scheduleRequest";
import {
  getSchedulesForInstallation,
  getScheduleById,
} from "~/server/util/routes/schedule";
import {
  createScheduleForInstallation,
  updateScheduleWithValidation,
  deleteScheduleWithValidation,
} from "~/server/util/services/scheduleService";

export const router = express.Router();

router.use(resolveActorMiddleware);

router.get("/", async (req, res) => {
  const schedules = await getSchedulesForInstallation(
    req.actor!.installationId,
  );
  res.status(200).json(schedules);
});

router.get("/:id", async (req, res) => {
  const schedule = await getScheduleById(req.params.id);
  // A column-level FK guarantees the row *exists*, not that it belongs to
  // the *caller's* installation — 404 (not 403) so a cross-tenant guess
  // can't be distinguished from a genuinely unknown id.
  if (!schedule || schedule.installationId !== req.actor!.installationId) {
    throw new HttpError(`Schedule ${req.params.id} not found.`, 404);
  }
  res.status(200).json(schedule);
});

router.post(
  "/",
  requirePermission("schedules.create"),
  validateBody(createScheduleRequestSchema),
  async (req, res) => {
    const body = req.body as CreateScheduleRequest;
    const schedule = await createScheduleForInstallation({
      installationId: req.actor!.installationId,
      name: body.name,
      events: body.events,
      config: body.config,
    });
    res.status(201).json(schedule);
  },
);

router.patch(
  "/:id",
  requirePermission("schedules.edit"),
  validateBody(updateScheduleRequestSchema),
  async (req, res) => {
    const body = req.body as UpdateScheduleRequest;
    const schedule = await updateScheduleWithValidation(
      req.actor!.installationId,
      req.params.id as string,
      {
        name: body.name,
        events: body.events,
        config: body.config,
      },
    );
    res.status(200).json(schedule);
  },
);

router.delete(
  "/:id",
  requirePermission("schedules.delete"),
  async (req, res) => {
    await deleteScheduleWithValidation(
      req.actor!.installationId,
      req.params.id as string,
    );
    res.status(204).send();
  },
);
