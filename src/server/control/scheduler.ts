import { FlairApiClient } from "~/server/util/flair/client";
import {
  HapControllerClient,
  type HomeKitClient,
} from "~/server/util/homekit/client";
import {
  getHomekitPairing,
  recordHomekitConnectionInfo,
} from "~/server/util/services/homekitPairingService";

// Fails closed, per "Environment & Dev Modes": unset, missing, or anything
// other than the literal string "false" means shadow mode. A missing env
// var must never be what lets a container start moving real vents.
// Exported so routes/settings.ts can surface this one read-only fact
// alongside the DB-backed config — see "Stage 14 follow-up: DRY_RUN
// visibility" — without duplicating the fail-closed parsing rule a second
// time somewhere else.
export function isDryRunEnv(): boolean {
  return process.env.DRY_RUN !== "false";
}

// One FlairClient per installation, reused across cycles — not recreated
// per tick. This matters beyond avoiding waste: FlairApiClient's outage
// tracker (see util/flair/outage.ts) and token-refresh-failure state are
// now both Redis-backed (outageStore.ts) rather than in-memory fields,
// specifically so this guarantee — logging a transition exactly once, not
// once per failed tick — holds across worker *processes* too, not just
// within one long-lived client instance. This per-process map is now
// purely a performance cache (avoid reconstructing a client every job),
// not the thing correctness depends on.
const clientsByInstallation = new Map<string, FlairApiClient>();
// Exported so routes/sync.ts (a one-off, user-triggered Flair fetch, not
// a tick), routes/airHandlers.ts, routes/control.ts, and tickProcessor.ts
// all share the same per-installation client rather than each
// constructing their own with independent in-process state.
export function getFlairClient(installationId: string): FlairApiClient {
  let client = clientsByInstallation.get(installationId);
  if (!client) {
    client = new FlairApiClient(installationId);
    clientsByInstallation.set(installationId, client);
  }
  return client;
}

// One HomeKitClient per air handler, reused across ticks for the same
// reason as clientsByInstallation above — HapControllerClient caches its
// own connection/characteristic-map internally once connected, so reusing
// the same instance avoids reconnecting (and re-discovering the
// accessory's address/port over mDNS) every single tick.
const homeKitClientsByAirHandler = new Map<string, HomeKitClient>();

// Cleared by the unpair route so a *new* pairing (or none at all) is
// picked up fresh on the next tick, rather than an earlier cached client
// silently continuing to hold stale, now-invalid pairing data.
export function clearHomeKitClientCache(airHandlerId: string): void {
  homeKitClientsByAirHandler.delete(airHandlerId);
}

// Wired into TickDeps.getHomeKitClient — resolves to null (not a throw)
// when this air handler has no stored pairing at all, which is the
// ordinary, expected state for any handler not using "homekit" delivery
// mode; tick.ts itself is what turns "no client" into a logged,
// non-fatal dispatch failure for handlers that *are* configured for it.
export async function getHomeKitClientForAirHandler(
  airHandlerId: string,
): Promise<HomeKitClient | null> {
  const cached = homeKitClientsByAirHandler.get(airHandlerId);
  if (cached) return cached;

  const pairing = await getHomekitPairing(airHandlerId);
  if (!pairing) return null;

  const client = new HapControllerClient(
    pairing.accessoryId,
    pairing.pairingData,
    pairing.lastKnownAddress,
    pairing.lastKnownPort,
    (address, port) => {
      recordHomekitConnectionInfo(airHandlerId, address, port).catch(() => {
        // Purely an opportunistic cache update for the *next* connect's
        // fast path — a failure here has no bearing on this tick.
      });
    },
  );
  homeKitClientsByAirHandler.set(airHandlerId, client);
  return client;
}
