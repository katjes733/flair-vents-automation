import express from "express";
import { randomUUID } from "crypto";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { getFlairTokenByInstallation } from "~/server/util/routes/flairToken";
import { buildFlairAuthorizeUrl } from "~/server/util/auth";
import { redis } from "~/server/util/redis";

const apiLog = logger.child({ service: "api" });

export const router = express.Router();

// Drives the "re-authenticate with Flair" UI state (Phase 1's GlobalStatusBar
// connection chip) — never authenticated, needs re-auth (a recorded refresh
// error), or healthy.
router.get("/status", async (_req, res) => {
  const installation = await getOrCreateDefaultInstallation();
  const token = await getFlairTokenByInstallation(installation.id);
  if (!token || !token.accessToken) {
    res.status(200).json({ authenticated: false });
    return;
  }
  res.status(200).json({
    authenticated: !token.lastRefreshError,
    scope: token.scope,
    expiresAt: token.expiresAt,
    lastRefreshError: token.lastRefreshError,
    lastRefreshErrorAt: token.lastRefreshErrorAt,
  });
});

// Only meaningful in authorization_code mode — dormant under
// client_credentials, where there's no browser redirect at all. State lives
// in Redis (fva:oauth:state:<state>, 10-minute TTL), not a session — this
// app has no express-session per the no-auth-initially decision.
router.get("/authorize", async (req, res) => {
  if (
    (process.env.FLAIR_GRANT_MODE || "client_credentials") !==
    "authorization_code"
  ) {
    res.status(400).json({
      error:
        "FLAIR_GRANT_MODE is not authorization_code; nothing to authorize.",
    });
    return;
  }

  const installation = await getOrCreateDefaultInstallation();
  const state = randomUUID();
  const redirectUri = `${req.protocol}://${req.get("host")}/callback`;

  await redis.set(
    `oauth:state:${state}`,
    JSON.stringify({
      installationId: installation.id,
      expiresAt: Date.now() + 10 * 60 * 1000,
    }),
    "EX",
    600,
  );

  apiLog.info(
    { installation_id: installation.id },
    "Flair OAuth authorize flow started",
  );
  res.redirect(buildFlairAuthorizeUrl({ redirectUri, state }));
});
