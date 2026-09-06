import express from "express";
import { randomUUID } from "crypto";
import { resolveActorMiddleware } from "~/server/middleware/resolveActorMiddleware";
import { requirePermission } from "~/server/middleware/requirePermission";
import { getFlairTokenByInstallation } from "~/server/util/routes/flairToken";
import {
  buildFlairAuthorizeUrl,
  getEnvFlairCredentials,
} from "~/server/util/auth";
import { redis } from "~/server/util/redis";

const apiLog = logger.child({ service: "api" });

export const router = express.Router();

router.use(resolveActorMiddleware);

// Drives the "re-authenticate with Flair" UI state (Phase 1's GlobalStatusBar
// connection chip) — never authenticated, needs re-auth (a recorded refresh
// error), or healthy.
router.get("/status", async (req, res) => {
  const token = await getFlairTokenByInstallation(req.actor!.installationId);
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
// client_credentials (every BYO-onboarded installation's actual grant mode,
// per the SaaS Transformation plan's "Flair BYO-Credentials Onboarding"
// section), where there's no browser redirect at all. Stays keyed to the
// global env-configured credentials, not per-installation BYO ones — see
// that same plan section for why. State lives in Redis
// (fva:oauth:state:<state>, 10-minute TTL), not a session.
router.get(
  "/authorize",
  requirePermission("flairConnection.reauthorize"),
  async (req, res) => {
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

    const installationId = req.actor!.installationId;
    const state = randomUUID();
    const redirectUri = `${req.protocol}://${req.get("host")}/callback`;

    await redis.set(
      `oauth:state:${state}`,
      JSON.stringify({
        installationId,
        expiresAt: Date.now() + 10 * 60 * 1000,
      }),
      "EX",
      600,
    );

    apiLog.info(
      { installation_id: installationId },
      "Flair OAuth authorize flow started",
    );
    res.redirect(
      buildFlairAuthorizeUrl(getEnvFlairCredentials(), { redirectUri, state }),
    );
  },
);
