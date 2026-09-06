import express, { type Router } from "express";
import argon2 from "argon2";
import { totp, generateKey } from "otp-io";
import { randomBytes } from "otp-io/crypto";
import { v4 } from "uuid";
import AppDataSource from "~/server/database/datasource";
import { sendEmail, escapeHtml } from "~/server/util/mailing";
import { hmac } from "~/server/util/totp";
import { getUserByEmail } from "~/server/util/routes/user";
import { storePendingSignup } from "~/server/util/pendingSignup";
import { completeByoFlairSignup } from "~/server/util/services/signupService";
import { createRateLimiter } from "~/server/middleware/rateLimiter";
import { validateBody } from "~/server/middleware/validateBody";
import {
  SendCodeSchema,
  VerifyCodeSchema,
  SignupSchema,
  ConnectFlairSchema,
} from "~/shared/schemas/auth";
import type { ISignupVerification } from "~/server/database/models/signupVerification";

const authLog = logger.child({ service: "auth" });

export const router: Router = express.Router();

// A self-signup user is already on the signup page waiting for this code,
// so a short window is fine. A future delegate-invite flow (planned, not
// yet built) would pass its own, longer TTL — an invitee has to notice the
// email first, possibly much later.
export const SELF_SIGNUP_CODE_TTL_MINUTES = 15;

const sendCodeLimiter = createRateLimiter("send-code", {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: "Too many verification code requests. Try again in 15 minutes.",
});
const verifyCodeLimiter = createRateLimiter("verify-code", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many verification attempts. Try again in 15 minutes.",
});
const signupLimiter = createRateLimiter("signup", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many signup attempts. Try again in 15 minutes.",
});
const connectFlairLimiter = createRateLimiter("connect-flair", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: "Too many attempts. Try again in 15 minutes.",
});

// Generates a verification code, stores it, and emails it — shared by the
// public self-signup /send-code endpoint and (once built) a delegate-invite
// flow, which would differ only in wording and TTL.
export async function generateAndSendCode(
  email: string,
  buildEmail: (_code: string) => {
    subject: string;
    text: string;
    html?: string;
  },
  ttlMinutes: number = SELF_SIGNUP_CODE_TTL_MINUTES,
): Promise<void> {
  const secret = generateKey(randomBytes, 20);
  const code = await totp(hmac, { secret });
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await upsert({ email, code: await argon2.hash(code), expires_at: expiresAt });
  const { subject, text, html } = buildEmail(code);
  await sendEmail(subject, text, email, true, html);
}

router.post(
  "/send-code",
  sendCodeLimiter,
  validateBody(SendCodeSchema),
  async (req, res, next) => {
    const { email } = req.body;

    // A real, completed signup should block a resend of this same code —
    // but a delegate-invite placeholder row (password_hash === '', once
    // that flow exists) must still be able to receive one, so the check
    // is specifically "does a real signup already exist," not "does any
    // users row exist."
    const existingUser = await getUserByEmail(email);
    if (existingUser && existingUser.passwordHash !== "") {
      res.json({ message: "Verification code sent" });
      return;
    }

    try {
      const origin = `${req.protocol}://${req.get("host")}`;
      const signupUrl = `${origin}/signup?email=${encodeURIComponent(email)}`;
      await generateAndSendCode(email, (code) => ({
        subject: "Your Flair Vents Automation verification code",
        text: `Your verification code is: ${code}\n\nThis code is valid for ${SELF_SIGNUP_CODE_TTL_MINUTES} minutes.\n\nContinue signup: ${signupUrl}`,
        html: `<p>Your verification code is: <strong>${code}</strong></p>
<p>This code is valid for ${SELF_SIGNUP_CODE_TTL_MINUTES} minutes.</p>
<p><a href="${escapeHtml(signupUrl)}">Continue signup</a></p>`,
      }));
      res.json({ message: "Verification code sent" });
    } catch (error) {
      authLog.error({ err: error }, "Sending verification code failed");
      next(error);
    }
  },
);

async function upsert(record: ISignupVerification) {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "SignupVerification",
  );
  const { email, code, expires_at } = record;
  const existing = await repo.findOneBy({ email });
  const id = existing ? existing.id : v4();
  const newDate = new Date();
  if (!existing) {
    await repo.insert({
      id,
      creation_time: newDate,
      modified_time: newDate,
      email,
      code,
      expires_at,
    });
  } else {
    await repo.update(existing.id, {
      modified_time: newDate,
      code,
      expires_at,
    });
  }
}

router.post(
  "/verify-code",
  verifyCodeLimiter,
  validateBody(VerifyCodeSchema),
  async (req, res) => {
    const { email, code } = req.body;

    const repo = (await AppDataSource.getInstance()).getRepository(
      "SignupVerification",
    );
    const existing = await repo.findOneBy({ email });

    if (!existing) {
      res.status(404).json({ error: "Verification record not found" });
      return;
    }

    const { code: storedCode, expires_at } = existing;

    let isValid: boolean;
    try {
      isValid = await argon2.verify(storedCode, code);
    } catch {
      isValid = false;
    }
    if (!isValid) {
      res.status(400).json({ error: "Invalid verification code" });
      return;
    }

    if (expires_at < new Date()) {
      res.status(410).json({ error: "Verification code expired" });
      return;
    }

    res.json({ message: "Verification code is valid" });
  },
);

// Held in Redis only, per pendingSignup.ts — this is NOT yet a real
// account. It becomes one only once /connect-flair below succeeds.
router.post(
  "/signup",
  signupLimiter,
  validateBody(SignupSchema),
  async (req, res) => {
    const { email, password } = req.body;
    const existingUser = await getUserByEmail(email);
    if (existingUser && existingUser.passwordHash !== "") {
      res
        .status(409)
        .json({ error: "An account with this email already exists." });
      return;
    }
    await storePendingSignup(email, {
      passwordHash: await argon2.hash(password),
    });
    res.json({ message: "Signup started" });
  },
);

// The step that actually materializes the account — see the SaaS
// Transformation plan's "Flair BYO-Credentials Onboarding" section.
router.post(
  "/connect-flair",
  connectFlairLimiter,
  validateBody(ConnectFlairSchema),
  async (req, res, next) => {
    try {
      const result = await completeByoFlairSignup({
        req,
        email: req.body.email,
        flairClientId: req.body.flairClientId,
        flairClientSecret: req.body.flairClientSecret,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
