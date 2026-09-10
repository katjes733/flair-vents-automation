import express from "express";
import { z } from "zod";
import { validateBody } from "~/server/middleware/validateBody";
import { HttpError } from "~/server/util/httpError";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import { getAirHandlerById } from "~/server/util/routes/airHandler";
import { getZonesForAirHandler } from "~/server/util/routes/zone";
import {
  getHomekitPairing,
  storeHomekitPairing,
  deleteHomekitPairing,
} from "~/server/util/services/homekitPairingService";
import {
  getHomeKitClientForAirHandler,
  clearHomeKitClientCache,
} from "~/server/control/scheduler";
import {
  pairHomeKitAccessory,
  discoverUnpairedAccessories,
} from "~/server/util/homekit/client";
import { computeSensorMatches } from "~/server/util/homekit/sensorMatch";

// Mounted at the same "/api/v1/air-handlers" base path as
// routes/airHandlers.ts (a second router, not merged into that file) —
// matching its own existing "/:id/tick-decision" nested-sub-resource
// convention exactly, including the ":id" param name.
export const router = express.Router();

router.use(resolveActorMiddleware);

// Same "404, not 403, on a cross-tenant guess" pattern as every other
// per-air-handler route (src/server/routes/airHandlers.ts). Returns the
// air handler's own `id` (a real, validated string) for callers to use
// downstream, rather than having each one re-read the raw route param.
async function requireOwnAirHandler(req: express.Request) {
  const airHandlerId = String(req.params.id);
  const airHandler = await getAirHandlerById(airHandlerId);
  if (!airHandler || airHandler.installationId !== req.actor!.installationId) {
    throw new HttpError(`Air handler ${airHandlerId} not found.`, 404);
  }
  return airHandler;
}

router.get(
  "/:id/homekit/status",
  requirePermission("dashboard.airHandler.access"),
  async (req, res) => {
    const airHandler = await requireOwnAirHandler(req);
    const pairing = await getHomekitPairing(airHandler.id);
    if (!pairing) {
      res.status(200).json({ paired: false });
      return;
    }
    const client = await getHomeKitClientForAirHandler(airHandler.id);
    const reachable = client ? await client.isPaired() : false;
    res.status(200).json({
      paired: true,
      accessoryId: pairing.accessoryId,
      pairedAt: pairing.pairedAt,
      reachable,
      lastConnectError: pairing.lastConnectError,
      lastConnectErrorAt: pairing.lastConnectErrorAt,
    });
  },
);

router.post(
  "/:id/homekit/discover",
  requirePermission("dashboard.airHandler.access"),
  async (req, res) => {
    await requireOwnAirHandler(req);
    const found = await discoverUnpairedAccessories();
    res.status(200).json({ accessories: found });
  },
);

const pairRequestSchema = z.object({
  accessoryId: z.string().min(1),
  setupCode: z
    .string()
    .regex(/^\d{3}-\d{2}-\d{3}$/, "Setup code must be in the form XXX-XX-XXX"),
});

router.post(
  "/:id/homekit/pair",
  requirePermission("dashboard.airHandler.edit"),
  validateBody(pairRequestSchema),
  async (req, res) => {
    const airHandler = await requireOwnAirHandler(req);
    const { accessoryId, setupCode } = req.body as z.infer<
      typeof pairRequestSchema
    >;

    const { pairingData, address, port } = await pairHomeKitAccessory(
      accessoryId,
      setupCode,
    );
    await storeHomekitPairing({
      airHandlerId: airHandler.id,
      accessoryId,
      pairingData,
      address,
      port,
    });
    clearHomeKitClientCache(airHandler.id);
    res.status(200).json({ paired: true, accessoryId });
  },
);

router.post(
  "/:id/homekit/unpair",
  requirePermission("dashboard.airHandler.edit"),
  async (req, res) => {
    const airHandler = await requireOwnAirHandler(req);
    const client = await getHomeKitClientForAirHandler(airHandler.id);
    // Cleanly release this admin's own pairing slot on the real device
    // first — so it's free to re-pair with anything else (e.g. Apple
    // Home) afterward — rather than just forgetting our own credentials
    // and leaving the accessory believing it's still paired to a client
    // that no longer exists.
    if (client) {
      await client.removePairing();
    }
    await deleteHomekitPairing(airHandler.id);
    clearHomeKitClientCache(airHandler.id);
    res.status(200).json({ paired: false });
  },
);

// Backs the SmartSensor-matching dialog — see "Ecobee SmartSensor Reading
// via HomeKit." Returns an empty match list (never a 404/500) for an
// unpaired air handler, mirroring "/status"'s own graceful-degradation
// shape, since "no pairing yet" is an ordinary state for this dialog to
// render (nothing to match), not an error.
router.get(
  "/:id/homekit/sensor-matches",
  requirePermission("dashboard.airHandler.access"),
  async (req, res) => {
    const airHandler = await requireOwnAirHandler(req);
    const client = await getHomeKitClientForAirHandler(airHandler.id);
    const readings = client ? await client.getSensorReadings() : new Map();
    const zones = await getZonesForAirHandler(airHandler.id);
    const matches = computeSensorMatches(
      [...readings.values()],
      zones.map((z) => ({
        id: z.id,
        name: z.name,
        homekitSensorSerial: z.config.homekit_sensor_serial,
      })),
    );
    res.status(200).json({ matches });
  },
);
