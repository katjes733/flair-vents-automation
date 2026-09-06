import type { Request, Response, NextFunction } from "express";
import { resolveActor } from "~/server/util/resolveActor";
import { actorContextStorage } from "~/server/util/actorContext";

// Resolves the full Actor (installation, effective profile, air-handler
// scope) for every installation-scoped request and attaches it to
// req.actor. Recomputed on every request, not cached in the session — an
// owner revoking or downgrading a delegate takes effect on the delegate's
// very next request, no stale-permission window. Must run after session
// auth (req.session.user must already be set).
//
// Unlike tesla-powerwall-automation's own resolveActorMiddleware, there is
// no "allow unlinked bootstrap" variant here — the BYO Flair onboarding
// flow's own ordering (email verified, THEN a live Flair credential
// validation call succeeds, THEN the installation/user/membership rows are
// all created atomically in one transaction) means a real, established
// session here never exists without an installation already attached. See
// the SaaS Transformation plan's "User and Account Data Model" section.
export async function resolveActorMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const loginEmail = req.session.user as string | undefined;
  if (!loginEmail) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  const requestedInstallationId = req.get("x-installation-id") ?? undefined;
  const result = await resolveActor(loginEmail, requestedInstallationId);
  if ("error" in result) {
    res
      .status(result.error === "ambiguous" ? 400 : 403)
      .json({ success: false, message: result.error });
    return;
  }
  req.actor = result;
  actorContextStorage.run(result, () => next());
}
