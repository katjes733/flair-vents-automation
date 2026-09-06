import { redis } from "~/server/util/redis";

const LOCKOUT_MAX = 5;
const LOCKOUT_TTL = 15 * 60; // seconds

function lockoutKey(email: string) {
  return `auth:lockout:${email}`;
}

export async function isLockedOut(email: string): Promise<boolean> {
  try {
    const count = await redis.get(lockoutKey(email));
    return count !== null && parseInt(count, 10) >= LOCKOUT_MAX;
  } catch {
    return false; // fail open — don't block login if Redis is unavailable
  }
}

export async function recordFailure(email: string): Promise<void> {
  try {
    const key = lockoutKey(email);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, LOCKOUT_TTL);
    }
  } catch {
    // Redis unavailable — skip silently
  }
}

export async function clearLockout(email: string): Promise<void> {
  try {
    await redis.del(lockoutKey(email));
  } catch {
    // Redis unavailable — skip silently
  }
}
