import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import type { Request, Response, NextFunction } from "express";
import { redis } from "~/server/util/redis";

const apiLog = logger.child({ service: "api" });

// A factory, not one fixed limiter — this app's specific routes
// (air handlers, zones, schedules, overrides, settings, sync, control) don't
// exist yet, and each will want its own budget/window once it does. `redis`
// already applies the fva: keyPrefix at the client level, so `routeKey` only
// needs to distinguish routes from each other, not from other apps'
// key namespaces.
export function createRateLimiter(
  routeKey: string,
  opts: { windowMs: number; limit: number; message: string },
) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "unknown"),
    store: new RedisStore({
      prefix: `rl:${routeKey}:`,
      sendCommand: (...args: string[]) =>
        redis.call(args[0], ...args.slice(1)) as Promise<any>,
    }),
    passOnStoreError: false,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // A custom handler (rather than the `message` option) is required to log
    // the hit — express-rate-limit calls this instead of its default response
    // logic once the limit is exceeded, so it's also responsible for sending
    // the response.
    handler: (req: Request, res: Response, _next: NextFunction) => {
      apiLog.warn({ route: req.path, ip: req.ip }, "Rate limit exceeded");
      res.status(429).json({ error: opts.message });
    },
  });
}
