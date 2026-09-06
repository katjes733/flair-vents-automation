import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import express from "express";
import session from "express-session";
import { RedisStore } from "connect-redis";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import AppDataSource from "~/server/database/datasource";
import { router as HealthRouter } from "~/server/routes/health";
import { router as FlairAuthRouter } from "~/server/routes/flairAuth";
import { router as AirHandlersRouter } from "~/server/routes/airHandlers";
import { router as ZonesRouter } from "~/server/routes/zones";
import { router as SchedulesRouter } from "~/server/routes/schedules";
import { router as OverridesRouter } from "~/server/routes/overrides";
import { router as SettingsRouter } from "~/server/routes/settings";
import { router as ControlRouter } from "~/server/routes/control";
import { router as SyncRouter } from "~/server/routes/sync";
import { router as TelemetryRouter } from "~/server/routes/telemetry";
import { router as SessionRouter } from "~/server/routes/session";
import { router as SignupVerificationRouter } from "~/server/routes/signupVerification";
import { router as InstallationMembersRouter } from "~/server/routes/installationMembers";
import { router as WebauthnRouter } from "~/server/routes/webauthn";
import { getWebauthnConfig } from "~/server/util/requestOrigin";
import { errorHandler } from "~/server/middleware/errorHandler";
import { HttpError } from "~/server/util/httpError";
import { redis } from "~/server/util/redis";
import {
  validateOAuthState,
  exchangeAndSaveToken,
} from "~/server/util/oauthCallback";
import {
  getTokenWithAuthorizationCode,
  getEnvFlairCredentials,
} from "~/server/util/auth";
import { upsertFlairToken } from "~/server/util/routes/flairToken";
import { renderOAuthCallbackPage } from "~/server/util/oauthCallbackPage";
import { reconcileInstallationSchedulers } from "~/server/control/queue";

// Fail-fast: required env vars are checked synchronously at module load,
// not lazily on first request.
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
if (!process.env.ALLOWED_ORIGINS) {
  throw new Error("ALLOWED_ORIGINS environment variable is required");
}
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required");
}
if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

// Fail fast on a missing/invalid WEBAUTHN_RP_ID / WEBAUTHN_EXPECTED_ORIGINS
// at boot, the same as the other required config above — otherwise the
// misconfiguration only surfaces as a 500 the first time someone actually
// tries to use passkey registration/login.
getWebauthnConfig();

const sslEnabled = process.env.SSL_ENABLED === "true";
if (sslEnabled && (!process.env.SSL_KEY_PATH || !process.env.SSL_CERT_PATH)) {
  throw new Error(
    "SSL_KEY_PATH and SSL_CERT_PATH must be set when SSL_ENABLED=true",
  );
}

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    // The shared logger's redact.paths / req serializer (see logRedaction.ts)
    // apply to this automatic req/res logging exactly as they do to every
    // other log line — no separate redaction concern here.
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "debug";
    },
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        ...(sslEnabled ? {} : { upgradeInsecureRequests: null }),
      },
    },
    ...(sslEnabled ? {} : { crossOriginOpenerPolicy: false }),
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new HttpError(`CORS: origin ${origin} not allowed`, 403));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  }),
);

app.use(express.json({ limit: "100kb" }));

// connect-redis v9 expects node-redis v4 API ({ EX: ttl }); ioredis v5 uses
// positional args ('EX', ttl). This adapter bridges the two — ported from
// tesla-powerwall-automation's own working main.ts. Reuses the existing
// `redis` singleton (fva: keyPrefix already applied at the client level),
// rather than a second Redis connection — session keys land as
// fva:sess:<sid> for free.
const redisStoreClient = {
  get: (key: string) => redis.get(key),
  set: (key: string, value: string, options?: { EX?: number; PX?: number }) =>
    options?.EX != null
      ? redis.set(key, value, "EX", options.EX)
      : options?.PX != null
        ? redis.set(key, value, "PX", options.PX)
        : redis.set(key, value),
  del: (...keys: string[]) => redis.del(...keys),
  expire: (key: string, seconds: number) => redis.expire(key, seconds),
};

app.use(
  session({
    store: new RedisStore({ client: redisStoreClient as any }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: sslEnabled,
      // "lax" (not "strict") so the session cookie survives a future
      // cross-site OAuth-consent redirect if the deferred Flair
      // authorization_code fast-follow (see the SaaS Transformation plan's
      // "Open Research Items") ever ships — no cost to setting it now.
      sameSite: "lax",
      maxAge: 4 * 60 * 60 * 1000, // 4 hours — matches every other app on this NAS
    },
  }),
);

app.use("/api/v1/health", HealthRouter);
app.use("/api/v1/session", SessionRouter);
app.use("/api/v1/auth", SignupVerificationRouter);
app.use("/api/v1/webauthn", WebauthnRouter);
app.use("/api/v1/flair-auth", FlairAuthRouter);
app.use("/api/v1/air-handlers", AirHandlersRouter);
app.use("/api/v1/zones", ZonesRouter);
app.use("/api/v1/schedules", SchedulesRouter);
app.use("/api/v1/overrides", OverridesRouter);
app.use("/api/v1/settings", SettingsRouter);
app.use("/api/v1/control", ControlRouter);
app.use("/api/v1/sync", SyncRouter);
app.use("/api/v1/telemetry", TelemetryRouter);
app.use("/api/v1/installation-members", InstallationMembersRouter);

// Bare (not /api/v1) — this must match the OAuth redirect_uri Flair itself
// is configured with, and is only ever reached in authorization_code mode.
// State lives in Redis (fva:oauth:state:<state>, written by
// GET /api/v1/flair-auth/authorize), not a session.
const oauthCallbackLog = logger.child({ service: "oauth-callback" });

app.get("/callback", async (req, res) => {
  // Self-contained page (no external resources), so it gets its own tight
  // per-response CSP with a nonce for its inline <script>, rather than
  // relaxing the app-wide helmet policy.
  const nonce = randomBytes(16).toString("base64");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'`,
  );

  const state = req.query.state as string | undefined;
  const stateKey = state ? `oauth:state:${state}` : null;
  const storedRaw = stateKey ? await redis.get(stateKey) : null;
  if (stateKey) await redis.del(stateKey); // single-use, regardless of outcome

  const fail = (errorCode: string) => {
    res
      .type("html")
      .send(
        renderOAuthCallbackPage({ success: false, code: errorCode, nonce }),
      );
  };

  const stored = storedRaw
    ? (JSON.parse(storedRaw) as { installationId: string; expiresAt: number })
    : undefined;
  const validation = validateOAuthState(
    { code: req.query.code as string | undefined, state },
    stored && state
      ? {
          value: state,
          installationId: stored.installationId,
          expiresAt: stored.expiresAt,
        }
      : undefined,
    Date.now(),
  );
  if (!validation.ok) {
    fail(validation.code);
    return;
  }

  const redirectUri = `${req.protocol}://${req.get("host")}/callback`;
  const result = await exchangeAndSaveToken({
    code: req.query.code as string,
    redirectUri,
    installationId: validation.installationId,
    // Only ever reached in the dormant, global authorization_code mode —
    // stays keyed to the env-configured pair per the SaaS Transformation
    // plan's "Flair BYO-Credentials Onboarding" section, not per-installation
    // BYO credentials (client_credentials is the only grant BYO ever uses).
    getToken: (code, redirectUri) =>
      getTokenWithAuthorizationCode(
        getEnvFlairCredentials(),
        code,
        redirectUri,
      ),
    saveToken: upsertFlairToken,
    onError: (code, error) =>
      oauthCallbackLog.error(
        { err: error, installation_id: validation.installationId },
        code === "exchange_failed"
          ? "Flair token exchange failed"
          : "Error saving new Flair token",
      ),
  });
  if (!result.ok) {
    fail(result.code);
    return;
  }

  res.type("html").send(renderOAuthCallbackPage({ success: true, nonce }));
});

// Serves the built React frontend — dev mode never reaches this (Vite's own
// dev server on 5173 serves the frontend there, proxying /api/v1/* to this
// process); a real single-process deploy has no separate frontend server,
// so this process must serve it too. This was never exercised until a real
// deploy actually hit "Cannot GET /" — every prior verification in this
// project ran via `bun run dev`'s two-server split, which never needed it.
// Mirrors tesla-powerwall-automation's own working main.ts pattern exactly
// (verified there directly) rather than inventing a new one: index.html
// gets a hard no-store (a stale cached index.html can silently keep
// referencing old, no-longer-existing hashed asset filenames after a
// deploy, per vite.config.ts's emptyOutDir), while the hashed assets
// themselves are safe to cache indefinitely, since any content change
// gives them a new URL.
if (process.env.NODE_ENV !== "development") {
  logger.info("Serving static files from 'public' directory");
  const NEVER_CACHE = "no-cache, no-store, must-revalidate";
  app.use(
    express.static(path.join(process.cwd(), "public"), {
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", NEVER_CACHE);
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  app.use((_req, res) => {
    res.sendFile(path.join(process.cwd(), "public", "index.html"), {
      headers: { "Cache-Control": NEVER_CACHE },
    });
  });
}

app.use(errorHandler);

const port = parseInt(process.env.PORT || "3001", 10);

let server: http.Server | https.Server;
if (sslEnabled) {
  server = https.createServer(
    {
      key: fs.readFileSync(process.env.SSL_KEY_PATH!),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH!),
    },
    app,
  );
  logger.info("SSL is enabled. Running server with HTTPS.");
} else {
  server = http.createServer(app);
  logger.info("SSL is not enabled. Running server with HTTP.");
}

// Schema sync happens deterministically at boot, before the server accepts
// traffic — not lazily on whichever request happens to hit the DB first.
await AppDataSource.getInstance();

server.listen(port, () => {
  logger.info({ port, ssl: sslEnabled }, "Server listening");
});

// Registers (or updates) a BullMQ tick job scheduler for every active
// installation, and removes any stale ones — see queue.ts's own comment.
// Actual ticking now happens in a separate worker process (worker.ts)
// consuming these jobs, not here; a failure here must not prevent the API
// server from serving the UI, so it's logged and the server starts
// regardless — the next boot's reconciliation, or a future signup's own
// immediate registerInstallationTick() call, still recovers from it.
try {
  await reconcileInstallationSchedulers();
} catch (err) {
  logger.error(
    { err },
    "Job scheduler reconciliation failed — starting the API server anyway",
  );
}

// Stops accepting new connections — startup/shutdown of the actual tick
// processing lives in worker.ts's own process now, with its own SIGTERM
// handler.
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => process.exit(0));
});
