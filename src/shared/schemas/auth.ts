import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const SendCodeSchema = z.object({
  email: z.string().email(),
});

export const VerifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().min(1),
});

// Stores the pending signup (email verification and this step are
// sequenced client-side, not server-enforced — matching
// tesla-powerwall-automation's own /api/user/upsert, which doesn't
// re-check verification status either; the real proof of legitimacy is
// the live Flair credential validation in ConnectFlairSchema below).
export const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// The BYO Flair credentials step — see the SaaS Transformation plan's
// "Flair BYO-Credentials Onboarding" section.
export const ConnectFlairSchema = z.object({
  email: z.string().email(),
  flairClientId: z.string().min(1),
  flairClientSecret: z.string().min(1),
});

export type LoginInput = z.infer<typeof LoginSchema>;
export type SendCodeInput = z.infer<typeof SendCodeSchema>;
export type VerifyCodeInput = z.infer<typeof VerifyCodeSchema>;
export type SignupInput = z.infer<typeof SignupSchema>;
export type ConnectFlairInput = z.infer<typeof ConnectFlairSchema>;
