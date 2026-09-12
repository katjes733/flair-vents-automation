import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { systemSettingsConfigPartialSchema } from "~/shared/schemas/systemSettings";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import {
  getSystemSettings,
  updateSystemSettings,
} from "~/server/util/routes/systemSettings";
import { getZonesForInstallation } from "~/server/util/routes/zone";
import { reconcileZonePriorityOrder } from "~/server/domain/config/validateConfig";
import { updateSettingsForInstallation } from "~/server/util/services/settingsService";
import { isDryRunEnv } from "~/server/control/scheduler";

export const router = express.Router();

router.use(resolveActorMiddleware);

router.get("/", async (req, res) => {
  const installationId = req.actor!.installationId;
  const config = await getSystemSettings(installationId);
  // Self-heals zone_priority_order against current zones on every read,
  // not only on save — the priority-order UI only supports reordering, not
  // removing a single stale entry, so a page load is the moment a
  // deleted-and-recreated zone's dangling id most needs to already be
  // gone, rather than waiting on an unrelated settings save to trigger
  // updateSettingsForInstallation's own reconciliation. See
  // reconcileZonePriorityOrder's own comment.
  const zones = await getZonesForInstallation(installationId);
  const reconciledOrder = reconcileZonePriorityOrder(
    config.zone_priority_order,
    zones,
  );
  if (
    reconciledOrder.length !== config.zone_priority_order.length ||
    reconciledOrder.some((id, i) => id !== config.zone_priority_order[i])
  ) {
    config.zone_priority_order = reconciledOrder;
    await updateSystemSettings(installationId, config);
  }
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
