import { redis } from "~/server/util/redis";

// Rolling 24h window from the first call of the window, rather than aligned
// to UTC midnight — simpler, and the plan explicitly permits either. Key is
// bare (not per-installation) since this app runs against exactly one Flair
// account today; revisit if multi-account support is ever built.
const DAILY_BUDGET_KEY = "flair:tokenCallsToday";
const ROLLING_WINDOW_SECONDS = 24 * 60 * 60;

// ~50/day is Flair's own documented access-token *creation* limit per the
// flair-api-client-py reference client — a working assumption, not confirmed
// Flair behavior. See "Token persistence" in the implementation plan for why
// this is treated defensively either way.
export const FLAIR_TOKEN_DAILY_BUDGET = 50;

export async function recordTokenCall(): Promise<number> {
  const count = await redis.incr(DAILY_BUDGET_KEY);
  if (count === 1) {
    await redis.expire(DAILY_BUDGET_KEY, ROLLING_WINDOW_SECONDS);
  }
  return count;
}

export async function getTokenCallsToday(): Promise<number> {
  const value = await redis.get(DAILY_BUDGET_KEY);
  return value ? Number(value) : 0;
}
