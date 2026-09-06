import type { Request, Response, NextFunction } from "express";
import { getElementState } from "~/shared/permissions/profile";
import type { ActionKey } from "~/shared/permissions/schema";

// Must run after resolveActorMiddleware (reads req.actor). Uses the exact
// same getElementState(profile, actionKey) the client uses for rendering —
// "write" is the only passing state, and it's correct for read-type
// actions too: everyone clears the "access" floor, so a .access action
// always resolves to "write" for any authenticated actor. Ported from
// tesla-powerwall-automation's own requirePermission.ts — see
// shared/permissions/profile.ts for the full reasoning (including why this
// correctly denies admin-only paths to non-admins).
export function requirePermission(actionKey: ActionKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.actor) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    if (getElementState(req.actor.profile, actionKey) !== "write") {
      res
        .status(403)
        .json({ success: false, message: "Insufficient permission" });
      return;
    }
    next();
  };
}

// Reads the requested air handler id(s) from body/query and 403s if any
// requested id isn't in req.actor.scope.airHandlerIds ("*" always passes).
// Not yet called from any route — no delegate can have a narrower-than-"*"
// scope until the invite flow (planned, not yet built) exists — but this
// exists now so that stage is "wire it into the routes that need it," not
// "invent this mechanism under time pressure later."
export function requireAirHandlerScope(opts: {
  bodyKey?: string;
  queryKey?: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actor = req.actor;
    if (!actor) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    if (actor.scope.airHandlerIds === "*") {
      next();
      return;
    }
    const raw = opts.bodyKey
      ? req.body?.[opts.bodyKey]
      : req.query?.[opts.queryKey ?? ""];
    const requested: string[] = Array.isArray(raw)
      ? raw.map(String)
      : raw != null
        ? [String(raw)]
        : [];
    const denied = requested.filter(
      (id) => !(actor.scope.airHandlerIds as string[]).includes(id),
    );
    if (denied.length > 0) {
      res.status(403).json({
        success: false,
        message: `Not authorized for air handler(s): ${denied.join(", ")}`,
      });
      return;
    }
    next();
  };
}

// Whether every one of airHandlerIds falls within the actor's granted
// scope ("*" always passes) — for filtering list endpoints down to what a
// scoped delegate should actually see.
export function isWithinAirHandlerScope(
  airHandlerIds: string[],
  actorScope: string[] | "*",
): boolean {
  if (actorScope === "*") return true;
  return airHandlerIds.every((id) => actorScope.includes(id));
}
