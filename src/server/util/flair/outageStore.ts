import { redis } from "~/server/util/redis";

// Both moved here from FlairApiClient's own in-memory fields — necessary
// the moment more than one worker process can pick up a given
// installation's tick across different cycles (see the SaaS
// Transformation plan's "Rate-Limit and Token-Budget Correctness Under
// Multiple Workers"). An in-memory field only ever logs a transition
// exactly once per *process*; under N worker processes, each one's own
// tracker starts from "not failing," so the same real outage could log
// "detected" N times (once per worker that happens to pick up a cycle for
// it) instead of once. Same shape as airHandlerRuntimeStore.ts's own
// Redis get/set pattern.
export interface OutageState {
  failing: boolean;
  sinceMs: number | null;
}

export interface TokenRefreshFailureState {
  terminal: boolean;
  message: string;
}

const EMPTY_OUTAGE_STATE: OutageState = { failing: false, sinceMs: null };

export async function getOutageState(
  installationId: string,
): Promise<OutageState> {
  const raw = await redis.get(`flair:outage:${installationId}`);
  return raw ? JSON.parse(raw) : { ...EMPTY_OUTAGE_STATE };
}

export async function setOutageState(
  installationId: string,
  state: OutageState,
): Promise<void> {
  await redis.set(`flair:outage:${installationId}`, JSON.stringify(state));
}

export async function getTokenRefreshFailureState(
  installationId: string,
): Promise<TokenRefreshFailureState | null> {
  const raw = await redis.get(`flair:tokenRefreshFailure:${installationId}`);
  return raw ? JSON.parse(raw) : null;
}

// A null state is deleted, not stored as the literal string "null" —
// keeps a healthy installation's key entirely absent from Redis rather
// than an ever-present tombstone, and sidesteps any ambiguity between
// "never failed" and "failed, then recovered."
export async function setTokenRefreshFailureState(
  installationId: string,
  state: TokenRefreshFailureState | null,
): Promise<void> {
  const key = `flair:tokenRefreshFailure:${installationId}`;
  if (state === null) {
    await redis.del(key);
  } else {
    await redis.set(key, JSON.stringify(state));
  }
}
