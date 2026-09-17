import express from "express";
import { HttpError } from "~/server/util/httpError";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import { getZoneById, updateZoneState } from "~/server/util/routes/zone";
import { getSystemSettings } from "~/server/util/routes/systemSettings";

export const router = express.Router();

router.use(resolveActorMiddleware);

async function findOwnedZone(installationId: string, zoneId: string) {
  const zone = await getZoneById(zoneId);
  // Same 404-not-403 convention as zones.ts — a cross-tenant guess can't
  // be distinguished from a genuinely unknown id.
  if (!zone || zone.installationId !== installationId) {
    throw new HttpError(`Zone ${zoneId} not found.`, 404);
  }
  return zone;
}

// Requests a manual vent recalibration — a deliberate maintenance action
// (verify a vent someone physically inspected actually recloses cleanly),
// not the automatic detector noticing a problem, so it bypasses the
// debounce and tracking-window/temp-threshold conditions entirely once
// the tick loop picks it up (see evaluateVentMisalignment's own comment).
// Fire-and-forget: this just records the request; the control tick loop
// (not this response) actually runs the force-open/wait/snap-back cycle,
// typically starting within 60s and resolving within another minute or
// two — the dashboard reflects progress via its existing poll.
router.post(
  "/:zoneId/trigger",
  requirePermission("dashboard.zone.ventRecalibration.trigger"),
  async (req, res) => {
    const zone = await findOwnedZone(
      req.actor!.installationId,
      req.params.zoneId as string,
    );
    const settings = await getSystemSettings(req.actor!.installationId);
    if (!settings.vent_misalignment_auto_recalibration_enabled) {
      throw new HttpError(
        "Vent misalignment auto-recalibration must be enabled to use manual vent recalibration.",
        400,
      );
    }
    if (zone.state.vent_misalignment_recalibrating_since !== null) {
      throw new HttpError(
        "A recalibration cycle is already in progress for this zone.",
        409,
      );
    }
    await updateZoneState(zone.id, {
      ...zone.state,
      vent_manual_recalibration_requested_at: new Date().toISOString(),
    });
    res.status(202).json({ status: "requested" });
  },
);

// Clears a zone's "chronically misaligned" warning — resets its
// recalibration history, the entire input to isChronicallyMisaligned
// (ventMisalignment.ts), so the badge disappears until enough new
// recalibrations recur to re-flag it. Does not touch any in-progress
// cycle or the window/debounce state — an independent concern.
router.post(
  "/:zoneId/clear-warning",
  requirePermission("dashboard.zone.ventRecalibration.clearWarning"),
  async (req, res) => {
    const zone = await findOwnedZone(
      req.actor!.installationId,
      req.params.zoneId as string,
    );
    await updateZoneState(zone.id, {
      ...zone.state,
      vent_misalignment_recalibration_history: [],
    });
    res.status(204).send();
  },
);
