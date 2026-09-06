import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "~/server/util/actor";
import { SYSTEM_TICK_LOGIN_EMAIL } from "~/server/util/actor";

// Makes the current request's Actor visible to code that isn't in an HTTP
// request context (the control loop's tick processing, background alerting)
// without threading it through every function signature. Follows the
// promise chain through awaits, unlike the deprecated `domain` module.
// Ported verbatim from tesla-powerwall-automation's own actorContext.ts.
export const actorContextStorage = new AsyncLocalStorage<Actor>();

export function getCurrentActor(): Actor | undefined {
  return actorContextStorage.getStore();
}

// Used by the control loop and any other call that runs outside an HTTP
// request lifecycle, so those calls still get a recognizable actor identity
// in logs instead of "unknown".
export function runAsSystemTick<T>(
  installationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return actorContextStorage.run(
    {
      loginEmail: SYSTEM_TICK_LOGIN_EMAIL,
      source: "system",
      installationId,
      role: "owner",
      profile: "admin",
      scope: { airHandlerIds: "*" },
    },
    fn,
  );
}
