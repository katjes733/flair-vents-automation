import type { Request, Response, NextFunction } from "express";

// Cheap session-presence gate — no installation resolved, no permission
// check. Use resolveActorMiddleware + requirePermission for anything that
// needs to know WHICH installation or WHAT this login can do to it.
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }
  next();
}
