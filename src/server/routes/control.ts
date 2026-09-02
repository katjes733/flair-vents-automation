import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { z } from "zod";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { updateSettingsForInstallation } from "~/server/util/services/settingsService";
import { logControlDisarmed, logControlRearmed } from "~/server/logEvents";
import { triggerImmediateTick } from "~/server/control/scheduler";

export const router = express.Router();
const controlLog = logger.child({ service: "control" });

// Free-text display name, not a real user id — same per-browser
// localStorage-sourced actor mechanism as manual overrides (no auth yet).
const actorRequestSchema = z.object({ actor: z.string().min(1) });

router.post("/disarm", validateBody(actorRequestSchema), async (req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  await updateSettingsForInstallation(installation.id, {
    control_disarmed: true,
  });
  logControlDisarmed(controlLog, { actor: req.body.actor });
  res.status(200).json({ control_disarmed: true });
});

router.post("/rearm", validateBody(actorRequestSchema), async (req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  await updateSettingsForInstallation(installation.id, {
    control_disarmed: false,
  });
  logControlRearmed(controlLog, { actor: req.body.actor });
  res.status(200).json({ control_disarmed: false });
});

// User-triggered "refresh now" — e.g. right after the Sync Engine imports
// or links a zone, so its reading/classification is populated immediately
// instead of waiting up to a full tick interval. Coalesced with the
// scheduled loop in scheduler.ts, so this can never run a second,
// overlapping cycle against the same vents.
router.post("/trigger-tick", async (_req, res) => {
  await triggerImmediateTick();
  res.status(200).json({});
});
