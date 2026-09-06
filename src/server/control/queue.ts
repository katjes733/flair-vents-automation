import { Queue } from "bullmq";
import { queueConnection } from "~/server/control/queueConnection";
import {
  getActiveInstallations,
  type InstallationData,
} from "~/server/util/routes/installation";
import { getSystemSettings } from "~/server/util/routes/systemSettings";

const log = logger.child({ service: "queue" });

// One BullMQ queue for everything tick-related — a per-installation
// repeatable "run-tick" job scheduler for each active installation (see
// registerInstallationTick below), plus one fixed-id "queue-health-
// snapshot" scheduler for the whole queue. `prefix: "fva"` (not the
// shared util/redis.ts client's own `keyPrefix`, which this connection
// doesn't use — see queueConnection.ts) namespaces every key BullMQ
// itself creates the same way every other key in this app already is.
export const tickQueue = new Queue("tick", {
  connection: queueConnection,
  prefix: "fva",
});

const QUEUE_HEALTH_SNAPSHOT_JOB_ID = "queue-health-snapshot";
const QUEUE_HEALTH_SNAPSHOT_INTERVAL_MS = 30_000;

// Registers (or updates) the repeatable tick job for one installation,
// sourcing its cadence from that installation's own settings — called
// both by reconcileInstallationSchedulers() below (existing installations,
// checked at boot) and directly by signupService.ts the moment a new
// installation is created (so a fresh signup starts ticking immediately,
// not just at the API server's next restart).
export async function registerInstallationTick(
  installationId: string,
): Promise<void> {
  const settings = await getSystemSettings(installationId);
  await tickQueue.upsertJobScheduler(
    installationId,
    { every: settings.control_tick_interval_seconds * 1000 },
    { name: "run-tick", data: { installationId } },
  );
}

export async function deregisterInstallationTick(
  installationId: string,
): Promise<void> {
  await tickQueue.removeJobScheduler(installationId);
}

async function ensureQueueHealthSnapshotJob(): Promise<void> {
  await tickQueue.upsertJobScheduler(
    QUEUE_HEALTH_SNAPSHOT_JOB_ID,
    { every: QUEUE_HEALTH_SNAPSHOT_INTERVAL_MS },
    { name: "queue-health-snapshot", data: {} },
  );
}

// Called once at API-server boot (main.ts) — diffs the DB's own set of
// active installations against whatever job schedulers BullMQ currently
// has registered, registering any missing ones and removing any stale
// ones (e.g. an installation deactivated since the last boot, or one
// created before this mechanism existed at all — this is exactly how the
// one real pre-existing installation from before this stage gets picked
// up). New signups don't have to wait for this — see
// registerInstallationTick's own comment.
export async function reconcileInstallationSchedulers(): Promise<void> {
  await ensureQueueHealthSnapshotJob();

  const installations: InstallationData[] = await getActiveInstallations();
  const activeIds = new Set(installations.map((i) => i.id));

  const schedulers = await tickQueue.getJobSchedulers();
  const registeredInstallationIds = schedulers
    .map((s) => s.id)
    .filter((id): id is string => !!id && id !== QUEUE_HEALTH_SNAPSHOT_JOB_ID);

  for (const installation of installations) {
    if (!registeredInstallationIds.includes(installation.id)) {
      await registerInstallationTick(installation.id);
      log.info(
        { installation_id: installation.id },
        "Registered tick job scheduler for installation",
      );
    }
  }

  for (const registeredId of registeredInstallationIds) {
    if (!activeIds.has(registeredId)) {
      await deregisterInstallationTick(registeredId);
      log.info(
        { installation_id: registeredId },
        "Removed tick job scheduler for installation no longer active",
      );
    }
  }
}
