import express, { type Router } from "express";
import argon2 from "argon2";
import { totp, generateKey } from "otp-io";
import { randomBytes } from "otp-io/crypto";
import { v4 } from "uuid";
import AppDataSource from "~/server/database/datasource";
import { sendEmail, escapeHtml } from "~/server/util/mailing";
import { hmac } from "~/server/util/totp";
import { getUserByEmail, updateUserPassword } from "~/server/util/routes/user";
import { invalidateAllSessionsForUser } from "~/server/util/sessionRegistry";
import { createRateLimiter } from "~/server/middleware/rateLimiter";
import { validateBody } from "~/server/middleware/validateBody";
import {
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from "~/shared/schemas/auth";
import type { IPasswordResetCode } from "~/server/database/models/passwordResetCode";

const authLog = logger.child({ service: "auth" });

export const router: Router = express.Router();

// Matches self-signup's own TTL — the user is expected to be actively
// waiting on this email, not returning to it hours later.
const RESET_CODE_TTL_MINUTES = 15;

const forgotPasswordLimiter = createRateLimiter("forgot-password", {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: "Too many password reset requests. Try again in 15 minutes.",
});
const resetPasswordLimiter = createRateLimiter("reset-password", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many attempts. Try again in 15 minutes.",
});

async function upsertResetCode(record: IPasswordResetCode): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "PasswordResetCode",
  );
  const { email, code, expires_at } = record;
  const existing = await repo.findOneBy({ email });
  const id = existing ? existing.id : v4();
  const now = new Date();
  if (!existing) {
    await repo.insert({
      id,
      creation_time: now,
      modified_time: now,
      email,
      code,
      expires_at,
    });
  } else {
    await repo.update(existing.id, { modified_time: now, code, expires_at });
  }
}

async function deleteResetCode(email: string): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "PasswordResetCode",
  );
  await repo.delete({ email });
}

// Unlike signupVerification.ts's verifyStoredCode (deliberately not
// consumed on success — see that file's own comment), a password reset
// code is single-use by design: the whole point is that whoever has the
// code can take over the account's credential, so a captured/logged code
// must not go on working after it's already been used once. The caller is
// responsible for calling deleteResetCode() after a successful reset.
async function verifyResetCode(
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "PasswordResetCode",
  );
  const existing = await repo.findOneBy({ email });
  if (!existing) {
    return { ok: false, status: 400, error: "Invalid or expired code." };
  }

  let isValid: boolean;
  try {
    isValid = await argon2.verify(existing.code, code);
  } catch {
    isValid = false;
  }
  if (!isValid) {
    return { ok: false, status: 400, error: "Invalid or expired code." };
  }
  if (existing.expires_at < new Date()) {
    return { ok: false, status: 410, error: "Invalid or expired code." };
  }
  return { ok: true };
}

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  validateBody(ForgotPasswordSchema),
  async (req, res, next) => {
    const { email } = req.body;
    // Always the same response, whether or not this email has a real
    // account — anything else (a distinct "no account found" message) lets
    // an attacker enumerate real accounts by trying addresses one at a
    // time. The only observable difference is whether an email actually
    // arrives, which requires access to the inbox itself to notice.
    const GENERIC_MESSAGE =
      "If an account exists for that email, a password reset code has been sent.";
    try {
      // The "" password_hash sentinel (an invited-but-not-yet-activated
      // member — see installationMemberService.ts) has no real password to
      // reset; sending a code there would just confuse someone who hasn't
      // finished accepting their invite yet, so it's treated the same as
      // "no account" for this flow's purposes.
      const user = await getUserByEmail(email);
      if (!user || user.passwordHash === "") {
        res.json({ message: GENERIC_MESSAGE });
        return;
      }

      const secret = generateKey(randomBytes, 20);
      const code = await totp(hmac, { secret });
      const expiresAt = new Date(
        Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000,
      );
      await upsertResetCode({
        email,
        code: await argon2.hash(code),
        expires_at: expiresAt,
      });
      await sendEmail(
        "Reset your Flair Vents Automation password",
        `We received a request to reset your password.\n\nYour reset code is: ${code}\n\nThis code is valid for ${RESET_CODE_TTL_MINUTES} minutes. If you didn't request this, you can safely ignore this email — your password hasn't been changed.`,
        email,
        true,
        `<p>We received a request to reset your password.</p>
<p>Your reset code is: <strong>${escapeHtml(code)}</strong></p>
<p>This code is valid for ${RESET_CODE_TTL_MINUTES} minutes. If you didn't request this, you can safely ignore this email — your password hasn't been changed.</p>`,
      );
      res.json({ message: GENERIC_MESSAGE });
    } catch (error) {
      authLog.error({ err: error }, "Sending password reset code failed");
      next(error);
    }
  },
);

router.post(
  "/reset-password",
  resetPasswordLimiter,
  validateBody(ResetPasswordSchema),
  async (req, res, next) => {
    try {
      const { email, code, new_password: newPassword } = req.body;
      const user = await getUserByEmail(email);
      if (!user || user.passwordHash === "") {
        res.status(400).json({ error: "Invalid or expired code." });
        return;
      }

      const verified = await verifyResetCode(email, code);
      if (!verified.ok) {
        res.status(verified.status).json({ error: verified.error });
        return;
      }

      await updateUserPassword(user.id, await argon2.hash(newPassword));
      await deleteResetCode(email);
      // A reset is exactly the moment every existing session for this
      // account should stop working — whoever requested it may be doing so
      // precisely because they suspect their old password (and any session
      // it produced) is compromised. No session is carried forward; the
      // client is expected to log in fresh with the new password.
      await invalidateAllSessionsForUser(email);
      authLog.info(
        { event: "auth.password_reset" },
        "Password reset via forgot-password flow",
      );
      res.json({
        message: "Password reset. Please log in with your new password.",
      });
    } catch (error) {
      next(error);
    }
  },
);
