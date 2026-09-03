export interface RedisDedup {
  exists: (key: string) => Promise<number>;
  set: (key: string, value: string) => Promise<unknown>;
  del: (...keys: string[]) => Promise<unknown>;
}

/**
 * Calls `send` once per error occurrence. Returns true if the notification was
 * sent (key was absent), false if it was suppressed (key was present).
 *
 * Fail-open: if Redis is unavailable, `send` is always called so that
 * alerts are never silently dropped.
 */
export async function notifyOnce(
  key: string,
  send: () => void | Promise<void>,
  redisClient: RedisDedup,
): Promise<boolean> {
  const already = await redisClient.exists(key).catch(() => 0);
  if (!already) {
    // Awaited — send() can do async work (e.g. resolving notification
    // recipients) before actually sending, and callers/tests rely on it
    // having fully completed by the time notifyOnce itself resolves.
    await send();
    await redisClient.set(key, "1").catch(() => {});
    return true;
  }
  return false;
}

/** Clears a dedup key so the next call to notifyOnce for that key will fire. */
export async function clearNotification(
  key: string,
  redisClient: RedisDedup,
): Promise<void> {
  await redisClient.del(key).catch(() => {});
}
