import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { z } from "zod";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
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
// instead of waiting up to a full tick interval. Coalesced with the
// scheduled loop in scheduler.ts, so this can never run a second,
// overlapping cycle against the same vents.
//
// Still single-installation-scoped internally (triggerImmediateTick()
// takes no installationId) — scheduler.ts's own multi-installation
// iteration is Stage 6 (horizontal scaling), not this stage; there is
// only ever one real installation running a tick loop today regardless.
router.post(
  "/trigger-tick",
  requirePermission("dashboard.triggerTick"),
  async (_req, res) => {
    await triggerImmediateTick();
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
    outage: client.getOutageState(),
    tokenRefreshFailure: client.getTokenRefreshFailureState(),
    tokenCallsToday,
    tokenDailyBudget: FLAIR_TOKEN_DAILY_BUDGET,
  });
});
