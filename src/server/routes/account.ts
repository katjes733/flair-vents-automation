import express, { type Router } from "express";
import argon2 from "argon2";
import { requireAuth } from "~/server/middleware/auth";
import { validateBody } from "~/server/middleware/validateBody";
import { createRateLimiter } from "~/server/middleware/rateLimiter";
import { DeleteAccountSchema } from "~/shared/schemas/auth";
import { getUserByEmail } from "~/server/util/routes/user";
import { deleteUserAccount } from "~/server/util/services/accountService";
import { maskEmail } from "~/server/util/maskEmail";

const authLog = logger.child({ service: "auth" });

export const router: Router = express.Router();

router.use(requireAuth);

// A confirmation-password brute force here still requires an already-valid
// session cookie (not just an email/password guess), but rate-limiting it
// anyway matches this app's own convention of limiting every auth-adjacent
// action, not just the ones reachable pre-login.
const deleteAccountLimiter = createRateLimiter("delete-account", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many attempts. Try again in 15 minutes.",
});

// Requires the caller to re-enter their current password — a deliberate
// improvement over tesla-powerwall-automation's equivalent route, which
// deletes on nothing more than an active session. Blocked (400, via
// deleteUserAccount → assertCanDeleteAccount) if the caller is the sole
// owner of any installation — see accountService.ts's own comment for why
// that's the safe default rather than cascading or auto-promoting.
router.delete(
  "/",
  deleteAccountLimiter,
  validateBody(DeleteAccountSchema),
  async (req, res, next) => {
    const email = req.session.user!;
    try {
      const user = await getUserByEmail(email);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const isValid = await argon2.verify(user.passwordHash, req.body.password);
      if (!isValid) {
        // 400, deliberately not 401 — a wrong confirmation password here
        // does not mean the session itself is invalid, but the client's
        // global httpClient interceptor treats ANY 401 as exactly that and
        // force-logs-out. This is a plain input-validation failure on an
        // already-authenticated request.
        res.status(400).json({ error: "Incorrect password." });
        return;
      }

      await deleteUserAccount({ userId: user.id, email });
      authLog.info(
        { event: "auth.account_deleted", email: maskEmail(email) },
        "Account deleted",
      );
      res.clearCookie("connect.sid");
      res.json({ message: "Account deleted." });
    } catch (error) {
      next(error);
    }
  },
);
