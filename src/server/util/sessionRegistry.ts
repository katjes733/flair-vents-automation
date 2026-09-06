import { redis } from "~/server/util/redis";

// express-session/connect-redis keeps no per-user index of a user's own
// sessions — only a session id → session-data mapping. Invalidating "every
// session for this user" (on password reset, account deletion, or an
// explicit "log out everywhere" action) needs that index built separately.
// A Redis SET per user (member = session id), refreshed on every login,
// TTL'd to the same lifetime as the cookie itself so a stale set can never
// meaningfully outlive the sessions it once pointed at.
const SESSION_SET_TTL_SECONDS = 4 * 60 * 60; // matches the cookie's own maxAge (main.ts)

function sessionSetKey(email: string): string {
  return `user-sessions:${email}`;
}

// connect-redis's own default key prefix (see RedisStore's `opts.prefix`) —
// this app's session middleware is constructed with no `prefix` override,
// so a session's real key is this literal string, `fva:` applied
// automatically by the shared ioredis client's own keyPrefix.
function sessionStoreKey(sid: string): string {
  return `sess:${sid}`;
}

// Called once per successful login (see sessionEstablish.ts) — records
// which session id belongs to this user, so it can later be torn down
// alongside every other session of theirs.
export async function registerSession(
  email: string,
  sid: string,
): Promise<void> {
  const key = sessionSetKey(email);
  await redis.sadd(key, sid);
  await redis.expire(key, SESSION_SET_TTL_SECONDS);
}

// Called on ordinary logout — removes just this one session id from the
// index, since the session itself is already being destroyed through the
// normal req.session.destroy() path.
export async function unregisterSession(
  email: string,
  sid: string,
): Promise<void> {
  await redis.srem(sessionSetKey(email), sid);
}

// Destroys every known session for this user, including whichever one is
// currently making the request (there is no "except this one" variant —
// see the route comment for why that's the deliberate, simpler choice).
// Foreign sessions can't go through req.session.destroy() (that only ever
// operates on the current request's own session), so this deletes their
// underlying Redis keys directly instead — the same key shape
// connect-redis itself would compute for the same session id.
export async function invalidateAllSessionsForUser(
  email: string,
): Promise<void> {
  const key = sessionSetKey(email);
  const sids = await redis.smembers(key);
  if (sids.length > 0) {
    await redis.del(...sids.map(sessionStoreKey));
  }
  await redis.del(key);
}
