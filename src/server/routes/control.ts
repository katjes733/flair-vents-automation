import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { z } from "zod";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { updateSettingsForInstallation } from "~/server/util/services/settingsService";
import { logControlDisarmed, logControlRearmed } from "~/server/logEvents";
import {
  triggerImmediateTick,
  getFlairClient,
} from "~/server/control/scheduler";
import {
  getTokenCallsToday,
  FLAIR_TOKEN_DAILY_BUDGET,
} from "~/server/util/flair/tokenBudget";

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

// Live connection health for FlairConnection's current-status panel — see
// "Stage 12 — Current-Status Diagnostics". Every value here is a direct
// read of state that already exists (outage tracking, token-refresh
// failure, the daily token-call counter); nothing new is computed or
// persisted by this route itself.
router.get("/flair-status", async (_req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  const client = getFlairClient(installation.id);
  const tokenCallsToday = await getTokenCallsToday();
  res.status(200).json({
    outage: client.getOutageState(),
    tokenRefreshFailure: client.getTokenRefreshFailureState(),
    tokenCallsToday,
    tokenDailyBudget: FLAIR_TOKEN_DAILY_BUDGET,
  });
});
