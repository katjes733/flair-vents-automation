import { redis } from "~/server/util/redis";

// Rolling 24h window from the first call of the window, rather than aligned
// to UTC midnight — simpler, and the plan explicitly permits either.
//
// Per-installation, not bare — each BYO-onboarded installation brings its
// own Flair Client ID/Secret (see the SaaS Transformation plan's "Flair
// BYO-Credentials Onboarding" section), so each tenant's ~50/day mint
// budget is against their own account, not a shared pool. A bare key here
// would falsely trip every tenant's budget alert off of every other
// tenant's usage — exactly backwards. This was a bare key until this
// migration (see that same plan section's own "becomes per-installation,
// required the moment there's more than one installation" note).
function dailyBudgetKey(installationId: string): string {
  return `flair:tokenCallsToday:${installationId}`;
}
const ROLLING_WINDOW_SECONDS = 24 * 60 * 60;

// ~50/day is Flair's own documented access-token *creation* limit per the
// flair-api-client-py reference client — a working assumption, not confirmed
// Flair behavior. See "Token persistence" in the implementation plan for why
// this is treated defensively either way.
export const FLAIR_TOKEN_DAILY_BUDGET = 50;

export async function recordTokenCall(installationId: string): Promise<number> {
  const key = dailyBudgetKey(installationId);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ROLLING_WINDOW_SECONDS);
  }
  return count;
}

export async function getTokenCallsToday(
  installationId: string,
): Promise<number> {
  const value = await redis.get(dailyBudgetKey(installationId));
  return value ? Number(value) : 0;
}
