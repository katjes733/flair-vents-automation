import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

// The same schema (via .superRefine()) serves this middleware and React
// form validation — one rule set, not two independently-drifting copies.
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
