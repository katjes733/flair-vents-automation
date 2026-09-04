import express from "express";
import { z } from "zod";
import { validateBody } from "~/server/middleware/validateBody";
import { createManualOverrideRequestSchema } from "~/shared/schemas/manualOverrideRequest";
import { resolveManualOverride } from "~/server/domain/targets/manualOverride";
import { HttpError } from "~/server/util/httpError";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { getZonesForInstallation } from "~/server/util/routes/zone";
import {
  createOverrideForZone,
  revokeOverride,
  getLatestOverridesForZones,
  getOverrideHistoryForZone,
} from "~/server/util/services/overrideService";

export const router = express.Router();

const MAX_RANGE_MS = 7 * 24 * 3600 * 1000;

const historyQuerySchema = z.object({
  fromMs: z.coerce.number().int().nonnegative(),
  toMs: z.coerce.number().int().nonnegative(),
});

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

// One zone's override history over a time range — backs the Telemetry
// page's override activity lane. Unlike GET /, this returns every row
// whose active window overlaps the range, not just the latest per zone.
router.get("/:zoneId/history", async (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(
      "fromMs and toMs (epoch milliseconds) are required query params.",
      400,
    );
  }
  const { fromMs, toMs } = parsed.data;
  if (toMs <= fromMs) {
    throw new HttpError("toMs must be after fromMs.", 400);
  }
  if (toMs - fromMs > MAX_RANGE_MS) {
    throw new HttpError(
      `Requested range is too wide — max ${MAX_RANGE_MS / 3_600_000} hours.`,
      400,
    );
  }

  const overrides = await getOverrideHistoryForZone(
    req.params.zoneId,
    fromMs,
    toMs,
  );
  res.status(200).json(overrides);
});
