import Redis from "ioredis";

const dbLog = logger.child({ service: "db" });

// keyPrefix is set at the client level, not left to each call site to
// remember — the same "enforce structurally, not by convention" principle
// already used for log redaction. Every key this app ever touches
// (fva:spike:<zoneId>, fva:recon:pending, fva:oauth:state:<state>,
// fva:flair:tokenCallsToday, rate-limit keys, etc.) is automatically
// namespaced, so it can never collide with tesla-powerwall-automation's
// bare rl:* keys or wake-on-lan's wol:* keys on the same shared instance.
export const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  keyPrefix: process.env.REDIS_KEY_PREFIX ?? "fva:",
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 3000,
  commandTimeout: 3000,
});

redis.on("error", (err) => {
  // Logged, not thrown — callers wrap commands in try/catch and fall back gracefully.
  dbLog.warn({ err }, "Redis connection error");
});
