import { httpClient } from "~/client/api/httpClient";
import type { SessionResult } from "~/client/api/sessionApi";

export async function sendCode(email: string): Promise<void> {
  await httpClient.post("/auth/send-code", { email });
}

export async function verifyCode(email: string, code: string): Promise<void> {
  await httpClient.post("/auth/verify-code", { email, code });
}

// Only stores a pending signup (Redis) — no real account exists yet. See
// connectFlair() below, the step that actually materializes one.
export async function signup(email: string, password: string): Promise<void> {
  await httpClient.post("/auth/signup", { email, password });
}

// The BYO Flair credentials step — the load-bearing part of onboarding.
// Returns the same shape a password/passkey login does, since this is what
// actually establishes the real session (see completeByoFlairSignup on the
// server).
export async function connectFlair(opts: {
  email: string;
  flairClientId: string;
  flairClientSecret: string;
}): Promise<SessionResult> {
  const { data } = await httpClient.post<SessionResult>(
    "/auth/connect-flair",
    opts,
  );
  return data;
}

// The invite-acceptance flow's own single step — turns an invited member's
// placeholder ("") password into a real one and logs them in, all at once.
export async function activateInvite(opts: {
  email: string;
  code: string;
  password: string;
}): Promise<SessionResult> {
  const { data } = await httpClient.post<SessionResult>(
    "/auth/activate-invite",
    opts,
  );
  return data;
}
