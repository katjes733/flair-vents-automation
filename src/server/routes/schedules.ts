import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { HttpError } from "~/server/util/httpError";
import {
  createScheduleRequestSchema,
  updateScheduleRequestSchema,
  type CreateScheduleRequest,
  type UpdateScheduleRequest,
} from "~/shared/schemas/scheduleRequest";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
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

router.get("/", async (_req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  const schedules = await getSchedulesForInstallation(installation.id);
  res.status(200).json(schedules);
});

router.get("/:id", async (req, res) => {
  const schedule = await getScheduleById(req.params.id);
  if (!schedule) {
    throw new HttpError(`Schedule ${req.params.id} not found.`, 404);
  }
  res.status(200).json(schedule);
});

router.post(
  "/",
  validateBody(createScheduleRequestSchema),
  async (req, res) => {
    const installation = await getOrCreateDefaultInstallation();
    const body = req.body as CreateScheduleRequest;
    const schedule = await createScheduleForInstallation({
      installationId: installation.id,
      name: body.name,
      events: body.events,
      config: body.config,
    });
    res.status(201).json(schedule);
  },
);

router.patch(
  "/:id",
  validateBody(updateScheduleRequestSchema),
  async (req, res) => {
    const body = req.body as UpdateScheduleRequest;
    const schedule = await updateScheduleWithValidation(
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

router.delete("/:id", async (req, res) => {
  await deleteScheduleWithValidation(req.params.id);
  res.status(204).send();
});
