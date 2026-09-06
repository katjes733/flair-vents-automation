import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { systemSettingsConfigPartialSchema } from "~/shared/schemas/systemSettings";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import { getSystemSettings } from "~/server/util/routes/systemSettings";
import { updateSettingsForInstallation } from "~/server/util/services/settingsService";
import { isDryRunEnv } from "~/server/control/scheduler";

export const router = express.Router();

router.use(resolveActorMiddleware);

router.get("/", async (req, res) => {
  const config = await getSystemSettings(req.actor!.installationId);
  // dry_run is a read-only, env-derived fact — not itself part of
  // system_settings.config (it's deliberately never DB-backed, see "Stage
  // 14 — Deploy" / the DRY_RUN vs. live_air_handler_ids split) — appended
  // here purely so the client can display the real global state (e.g. in
  // AirHandlerStatusCard's promotion-badge tooltip) without a second
  // network call. A PATCH to this same route ignores it — it's not part
  // of systemSettingsConfigPartialSchema, so it's simply stripped.
  res.status(200).json({ ...config, dry_run: isDryRunEnv() });
});

router.patch(
  "/",
  requirePermission("settings.write"),
  validateBody(systemSettingsConfigPartialSchema),
  async (req, res) => {
    const result = await updateSettingsForInstallation(
      req.actor!.installationId,
      req.body,
    );
    res.status(200).json(result);
  },
);
