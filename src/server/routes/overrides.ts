import express from "express";
import { validateBody } from "~/server/middleware/validateBody";
import { createManualOverrideRequestSchema } from "~/shared/schemas/manualOverrideRequest";
import { resolveManualOverride } from "~/server/domain/targets/manualOverride";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { getZonesForInstallation } from "~/server/util/routes/zone";
import {
  createOverrideForZone,
  revokeOverride,
  getLatestOverridesForZones,
} from "~/server/util/services/overrideService";

export const router = express.Router();

// The latest override row per zone, plus whether it's currently active
// (not expired/revoked) — the UI needs both: an expired/revoked hold is
// still part of the audit trail, active is what actually governs control.
router.get("/", async (_req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  const zones = await getZonesForInstallation(installation.id);
  const latest = await getLatestOverridesForZones(zones.map((z) => z.id));
  const nowMs = Date.now();
  const result = [...latest.values()].map((row) => ({
    ...row,
    active: resolveManualOverride(row, nowMs) !== null,
  }));
  res.status(200).json(result);
});

router.post(
  "/",
  validateBody(createManualOverrideRequestSchema),
  async (req, res) => {
    const override = await createOverrideForZone(req.body);
    res.status(201).json(override);
  },
);

router.post("/:id/revoke", async (req, res) => {
  await revokeOverride(req.params.id);
  res.status(204).send();
});
