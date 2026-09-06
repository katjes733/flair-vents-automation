import Redis from "ioredis";

// A second, BullMQ-dedicated connection — not the shared util/redis.ts
// singleton every domain store (spikeBuffer, reconciliationQueue, etc.)
// already uses. BullMQ requires maxRetriesPerRequest: null (it manages its
// own blocking-command/retry semantics internally) — incompatible with
// the shared client's own maxRetriesPerRequest: 1 degrade-and-log policy,
// which is correct for those domain stores but would break BullMQ's own
// connection handling if reused here. `{prefix: "fva"}` is passed to the
// Queue/Worker constructors themselves (not this connection), so BullMQ's
// own keys land under the same "fva:" namespace every other key in this
// app already uses on the shared NAS Redis instance.
export const queueConnection = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

queueConnection.on("error", (err) => {
  logger
    .child({ service: "queue" })
    .warn({ err }, "Queue Redis connection error");
});
