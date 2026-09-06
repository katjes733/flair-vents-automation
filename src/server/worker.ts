import { Worker } from "bullmq";
import AppDataSource from "~/server/database/datasource";
import { queueConnection } from "~/server/control/queueConnection";
import { tickProcessor } from "~/server/control/tickProcessor";

// Fail-fast: only the subset of main.ts's own required env vars this
// process actually needs — no ALLOWED_ORIGINS/SESSION_SECRET/WEBAUTHN_*
// (no HTTP server, no sessions, no passkeys here), but the same DB/Redis/
// token-encryption requirements, since this process talks to the same
// database and decrypts the same Flair tokens.
if (
  !process.env.DB_HOST ||
  !process.env.DB_USERNAME ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_NAME
) {
  throw new Error(
    "DB_HOST, DB_USERNAME, DB_PASSWORD, and DB_NAME environment variables are required",
  );
}
if (process.env.DB_SSL === "true" && !process.env.DB_SSL_CA_PATH) {
  throw new Error("DB_SSL_CA_PATH must be set when DB_SSL=true");
}
if (!process.env.REDIS_HOST) {
  throw new Error("REDIS_HOST environment variable is required");
}
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
}

// A distinct concern from DRY_RUN (the hard, redeploy-gated kill switch —
// see scheduler.ts's isDryRunEnv) — this stops the worker from picking up
// ANY tick job at all, scheduled or triggered, the same "disable the
// background loop" semantic the old setTimeout-based control loop's own
// CONTROL_LOOP_ENABLED check had. A manual /trigger-tick call still routes
// through the API server's own in-process call (control.ts), not this
// worker, so it's unaffected by this flag either way.
function isControlLoopEnabled(): boolean {
  return process.env.CONTROL_LOOP_ENABLED !== "false";
}

const log = logger.child({ service: "worker" });

if (!isControlLoopEnabled()) {
  log.warn(
    "CONTROL_LOOP_ENABLED=false — worker will not process any tick jobs",
  );
  process.exit(0);
}

// Connected once at boot, matching main.ts's own eager-connect convention
// — fail on a bad DB before accepting any jobs, not lazily on the first one.
await AppDataSource.getInstance();

// concurrency: 25 is deliberately generous — a tick's own compute is
// microseconds of math; wall-clock cost is almost entirely awaited Flair
// HTTP round-trips and DB queries (I/O-bound, not CPU-bound), so one
// worker process can hold many installations' ticks concurrently on
// Node's event loop long before this number is a real constraint. See the
// SaaS Transformation plan's "Worker Architecture" section.
const worker = new Worker("tick", tickProcessor, {
  connection: queueConnection,
  prefix: "fva",
  concurrency: 25,
  // Comfortably above TICK_LOCK_TTL_MS (tickProcessor.ts) and any
  // realistic tick_watchdog_seconds — BullMQ's own per-job lock is a
  // different mechanism than tickProcessor.ts's per-installation Redis
  // lock (see that file's own comment on why both exist), but should
  // still outlive a legitimately slow job rather than expire under it.
  lockDuration: 90_000,
  lockRenewTime: 30_000,
});

worker.on("failed", (job, err) => {
  log.error(
    { job_id: job?.id, job_name: job?.name, err },
    "Tick job failed — the next scheduled firing will still run regardless",
  );
});

log.info("Worker listening for tick jobs");

process.on("SIGTERM", () => {
  log.info("SIGTERM received, closing worker gracefully");
  worker
    .close()
    .then(() => process.exit(0))
    .catch((err) => {
      log.error({ err }, "Error while closing worker");
      process.exit(1);
    });
});
