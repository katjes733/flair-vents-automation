import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { HttpError } from "~/server/util/httpError";
import {
  createAirHandlerRequestSchema,
  updateAirHandlerRequestSchema,
  type CreateAirHandlerRequest,
  type UpdateAirHandlerRequest,
} from "~/shared/schemas/airHandlerRequest";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import {
  getAirHandlersForInstallation,
  getAirHandlerById,
} from "~/server/util/routes/airHandler";
import { getCachedTickDecision } from "~/server/control/tickDecision";
import {
  createAirHandlerForInstallation,
  updateAirHandlerWithValidation,
} from "~/server/util/services/airHandlerService";

export const router = express.Router();

router.get("/", async (_req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  const airHandlers = await getAirHandlersForInstallation(installation.id);
  res.status(200).json(airHandlers);
});

router.get("/:id", async (req, res) => {
  const airHandler = await getAirHandlerById(req.params.id);
  if (!airHandler) {
    throw new HttpError(`Air handler ${req.params.id} not found.`, 404);
  }
  res.status(200).json(airHandler);
});

router.post(
  "/",
  validateBody(createAirHandlerRequestSchema),
  async (req, res) => {
    const installation = await getOrCreateDefaultInstallation();
    const body = req.body as CreateAirHandlerRequest;
    const airHandler = await createAirHandlerForInstallation({
      installationId: installation.id,
      flairZoneId: body.flair_zone_id,
      name: body.name,
      active: body.active,
      config: body.config,
    });
    res.status(201).json(airHandler);
  },
);

router.patch(
  "/:id",
  validateBody(updateAirHandlerRequestSchema),
  async (req, res) => {
    const body = req.body as UpdateAirHandlerRequest;
    const airHandler = await updateAirHandlerWithValidation(
      req.params.id as string,
      {
        flairZoneId: body.flair_zone_id,
        name: body.name,
        active: body.active,
        config: body.config,
      },
    );
    res.status(200).json(airHandler);
  },
);

// The in-app answer to "what did the system just decide, and why" — see
// "Comprehensive tick decision record". 404s (not an empty 200) before the
// handler has ever ticked, e.g. immediately after startup.
router.get("/:id/tick-decision", async (req, res) => {
  const decision = getCachedTickDecision(req.params.id);
  if (!decision) {
    throw new HttpError(
      `No tick decision cached yet for air handler ${req.params.id}.`,
      404,
    );
  }
  res.status(200).json(decision);
});
