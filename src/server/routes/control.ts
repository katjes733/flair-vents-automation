import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { z } from "zod";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import { updateSettingsForInstallation } from "~/server/util/services/settingsService";
import { logControlDisarmed, logControlRearmed } from "~/server/logEvents";
import { getFlairClient } from "~/server/control/scheduler";
// The BullMQ job processor's own tick logic, called directly here rather
// than through the queue — this route needs a synchronous request/
// response its caller can await, which a fire-and-forget enqueue can't
// give it. Shares tickProcessor.ts's own per-installation Redis lock with
// every scheduled job, so this can never run concurrently with (or
// diverge in behavior from) one firing for the same installation.
import { processInstallationTick as triggerImmediateTick } from "~/server/control/tickProcessor";
import {
  getTokenCallsToday,
  FLAIR_TOKEN_DAILY_BUDGET,
} from "~/server/util/flair/tokenBudget";

export const router = express.Router();

router.use(resolveActorMiddleware);

const controlLog = logger.child({ service: "control" });

// Free-text display name, not a real user id — same per-browser
// localStorage-sourced actor mechanism as manual overrides (kept as-is for
// this stage — a real logged-in user's own name is a nicer default for it
// to eventually pre-fill from, not something this stage needs to change).
const actorRequestSchema = z.object({ actor: z.string().min(1) });

router.post(
  "/disarm",
  requirePermission("dashboard.controlDisarm.disarm"),
  validateBody(actorRequestSchema),
  async (req, res) => {
    await updateSettingsForInstallation(req.actor!.installationId, {
      control_disarmed: true,
    });
    logControlDisarmed(controlLog, { actor: req.body.actor });
    res.status(200).json({ control_disarmed: true });
  },
);

router.post(
  "/rearm",
  requirePermission("dashboard.controlDisarm.rearm"),
  validateBody(actorRequestSchema),
  async (req, res) => {
    await updateSettingsForInstallation(req.actor!.installationId, {
      control_disarmed: false,
    });
    logControlRearmed(controlLog, { actor: req.body.actor });
    res.status(200).json({ control_disarmed: false });
  },
);

// User-triggered "refresh now" — e.g. right after the Sync Engine imports
// or links a zone, so its reading/classification is populated immediately
// instead of waiting up to a full tick interval. Scoped to the caller's
// own installation only — a real improvement Stage 6's per-installation
// BullMQ jobs made possible; ticking used to run across every installation
// in one process, so this couldn't be scoped this precisely before.
router.post(
  "/trigger-tick",
  requirePermission("dashboard.triggerTick"),
  async (req, res) => {
    await triggerImmediateTick(req.actor!.installationId);
    res.status(200).json({});
  },
);

// Live connection health for FlairConnection's current-status panel — see
// "Stage 12 — Current-Status Diagnostics". Every value here is a direct
// read of state that already exists (outage tracking, token-refresh
// failure, the daily token-call counter); nothing new is computed or
// persisted by this route itself.
router.get("/flair-status", async (req, res) => {
  const client = getFlairClient(req.actor!.installationId);
  const tokenCallsToday = await getTokenCallsToday(req.actor!.installationId);
  res.status(200).json({
    outage: await client.getOutageState(),
    tokenRefreshFailure: await client.getTokenRefreshFailureState(),
    tokenCallsToday,
    tokenDailyBudget: FLAIR_TOKEN_DAILY_BUDGET,
  });
});
