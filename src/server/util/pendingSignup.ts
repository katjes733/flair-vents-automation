import { redis } from "~/server/util/redis";

// A brand-new self-signup isn't written to Postgres until BYO Flair
// credential validation succeeds (see the Flair BYO-Credentials Onboarding
// stage) — held here instead with a TTL so an abandoned signup just
// disappears on its own, no cleanup job needed. Ported from
// tesla-powerwall-automation's own pendingSignup.ts, whose equivalent gate
// is "abandoned before completing Tesla OAuth" rather than "abandoned
// before pasting valid Flair credentials" — same shape, different real
// cause. Delegate invites (planned, not yet built) are unaffected: an
// invite creates its placeholder users row directly in Postgres, so signup
// never takes this path for them.
const PENDING_SIGNUP_TTL_SECONDS = 24 * 60 * 60;

export interface PendingSignup {
  passwordHash: string;
  userDetails?: Record<string, unknown>;
}

function pendingSignupKey(email: string): string {
  return `auth:pending-signup:${email}`;
}

export async function storePendingSignup(
  email: string,
  data: PendingSignup,
): Promise<void> {
  await redis.set(
    pendingSignupKey(email),
    JSON.stringify(data),
    "EX",
    PENDING_SIGNUP_TTL_SECONDS,
  );
}

export async function getPendingSignup(
  email: string,
): Promise<PendingSignup | null> {
  try {
    const raw = await redis.get(pendingSignupKey(email));
    return raw ? (JSON.parse(raw) as PendingSignup) : null;
  } catch {
    // Fail closed — if Redis is unreachable we can't verify a pending
    // signup's credentials, so treat it as not found rather than as a
    // login bypass.
    return null;
  }
}

export async function deletePendingSignup(email: string): Promise<void> {
  await redis.del(pendingSignupKey(email));
}
