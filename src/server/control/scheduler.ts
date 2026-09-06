import { FlairApiClient } from "~/server/util/flair/client";

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
