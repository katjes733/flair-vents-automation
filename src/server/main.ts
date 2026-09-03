import http from "http";
import https from "https";
import fs from "fs";
import { randomBytes } from "crypto";
import express from "express";
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
import { errorHandler } from "~/server/middleware/errorHandler";
import { HttpError } from "~/server/util/httpError";
import { redis } from "~/server/util/redis";
import {
  validateOAuthState,
  exchangeAndSaveToken,
} from "~/server/util/oauthCallback";
import { getTokenWithAuthorizationCode } from "~/server/util/auth";
import { upsertFlairToken } from "~/server/util/routes/flairToken";
import { renderOAuthCallbackPage } from "~/server/util/oauthCallbackPage";
import {
  runStartupReconciliationForInstallation,
  startControlLoop,
} from "~/server/control/scheduler";

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

app.use("/api/v1/health", HealthRouter);
app.use("/api/v1/flair-auth", FlairAuthRouter);
app.use("/api/v1/air-handlers", AirHandlersRouter);
app.use("/api/v1/zones", ZonesRouter);
app.use("/api/v1/schedules", SchedulesRouter);
app.use("/api/v1/overrides", OverridesRouter);
app.use("/api/v1/settings", SettingsRouter);
app.use("/api/v1/control", ControlRouter);
app.use("/api/v1/sync", SyncRouter);

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
    getToken: getTokenWithAuthorizationCode,
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

// Startup reconciliation runs once, before the loop's first tick, so the
// first ramp starts from where the vents actually are rather than
// whatever the DB held across a restart — see "Reconciliation & startup
// reconciliation". A failure here (e.g. Flair unreachable at boot) must
// not prevent the server from serving the API/UI, so it's logged and the
// loop starts regardless — the loop's own per-handler try/catch and the
// next tick's own reconciliation sweep are what actually recover from it.
try {
  await runStartupReconciliationForInstallation();
} catch (err) {
  logger.error(
    { err },
    "Startup reconciliation failed — starting the control loop anyway",
  );
}
const controlLoop = startControlLoop();

// Stops accepting new connections and stops scheduling further ticks
// without moving anything — holding last position is this app's own
// stated safe default for any outage, so shutdown behaves the same way.
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  controlLoop.stop();
  server.close(() => process.exit(0));
});
