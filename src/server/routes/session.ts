import express, { type Router } from "express";
import argon2 from "argon2";
import { getUserByEmail } from "~/server/util/routes/user";
import { createRateLimiter } from "~/server/middleware/rateLimiter";
import { maskEmail } from "~/server/util/maskEmail";
import { validateBody } from "~/server/middleware/validateBody";
import { LoginSchema } from "~/shared/schemas/auth";
import { getPendingSignup } from "~/server/util/pendingSignup";
import { isLockedOut, recordFailure } from "~/server/util/authLockout";
import {
  buildSessionUser,
  establishSession,
} from "~/server/util/sessionEstablish";
import {
  unregisterSession,
  invalidateAllSessionsForUser,
} from "~/server/util/sessionRegistry";
import { requireAuth } from "~/server/middleware/auth";

// Extend express-session types to include the fields this app actually
// uses. `user` is deliberately just the login email, nothing richer —
// everything else (installation, role, profile, scope) is recomputed on
// every request via resolveActorMiddleware, never cached in the session.
declare module "express-session" {
  interface SessionData {
    expiry?: number;
    user?: string;
  }
}

const authLog = logger.child({ service: "auth" });

export const router: Router = express.Router();

const loginLimiter = createRateLimiter("login", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many login attempts. Try again in 15 minutes.",
});

router.post(
  "/login",
  loginLimiter,
  validateBody(LoginSchema),
  async (req, res) => {
    const { email, password } = req.body;
    const ip = req.ip;
    authLog.info(
      { event: "auth.login.attempt", email: maskEmail(email), ip },
      "Login attempt",
    );

    if (await isLockedOut(email)) {
      authLog.warn(
        { event: "auth.login.locked", email: maskEmail(email), ip },
        "Login blocked: account temporarily locked",
      );
      res.status(429).json({
        error: "Account temporarily locked. Try again in 15 minutes.",
      });
      return;
    }

    try {
      const user = await getUserByEmail(email);
      // A login with no users row yet may still be a pending self-signup
      // (email verified, password set, BYO Flair credentials not yet
      // submitted/validated) held in Redis — see
      // src/server/util/pendingSignup.ts. Letting them log in is what lets
      // them reach the "connect your Flair account" step.
      const pending = user ? null : await getPendingSignup(email);
      const passwordHash = user?.passwordHash ?? pending?.passwordHash;
      if (!passwordHash) {
        await recordFailure(email);
        authLog.warn(
          {
            event: "auth.login.failure",
            email: maskEmail(email),
            ip,
            reason: "user_not_found",
          },
          "Login failed: user not found",
        );
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const isValid = await argon2.verify(passwordHash, password);
      if (!isValid) {
        await recordFailure(email);
        authLog.warn(
          {
            event: "auth.login.failure",
            userId: user?.id,
            email: maskEmail(email),
            ip,
            reason: "invalid_password",
          },
          "Login failed: invalid password",
        );
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const result = await establishSession(req, email);
      authLog.info(
        {
          event: "auth.login.success",
          userId: user?.id,
          email: maskEmail(email),
          ip,
        },
        "Login successful",
      );
      res.json(result);
      return;
    } catch (error) {
      authLog.error(
        { event: "auth.login.error", email: maskEmail(email), ip, err: error },
        "Login error",
      );
      res.status(500).json({ error: "Server error" });
    }
  },
);

router.get("/me", async (req, res) => {
  if (req.session?.user) {
    res.json({
      user: await buildSessionUser(req.session.user),
      sessionExpiry: req.session.expiry,
    });
    return;
  }
  authLog.debug("Identification failed — no authenticated user");
  res.status(401).json({ message: "Not authenticated." });
});

router.post("/logout", async (req, res) => {
  const email = req.session.user;
  const ip = req.ip;
  if (email) {
    await unregisterSession(email, req.sessionID);
  }
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ message: "Failed to logout." });
      return;
    }
    authLog.info(
      { event: "auth.logout", email: email ? maskEmail(email) : null, ip },
      "User logged out",
    );
    res.clearCookie("connect.sid");
    res.json({ message: "Logged out." });
  });
});

// Destroys every session this login currently has, including whichever one
// made this very request — deliberately no "log out every OTHER device"
// variant. This is also the exact mechanism a password reset/account
// deletion needs (see passwordReset.ts and accountService.ts), so keeping
// one unqualified behavior means only one code path to reason about,
// rather than two subtly different session-teardown semantics.
router.post("/logout-everywhere", requireAuth, async (req, res) => {
  const email = req.session.user!;
  const ip = req.ip;
  await invalidateAllSessionsForUser(email);
  authLog.info(
    { event: "auth.logout_everywhere", email: maskEmail(email), ip },
    "User logged out of every session",
  );
  res.clearCookie("connect.sid");
  res.json({ message: "Logged out of every device." });
});
