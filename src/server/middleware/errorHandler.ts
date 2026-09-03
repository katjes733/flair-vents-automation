import type { Request, Response, NextFunction } from "express";
import { HttpError } from "~/server/util/httpError";

// Registered once, centrally, so every unhandled error — regardless of
// which route or middleware (e.g. CORS rejection) threw it — goes through
// the same redacted logger call and the same status-code convention,
// rather than each call site inventing its own.
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = err instanceof HttpError ? err.status : 500;
  // 5xx = unexpected internal failure, worth an alert-tier log; 4xx = an
  // expected rejection (bad input, disallowed origin) — routine, not alarming.
  if (status >= 500) {
    logger.error({ err }, "Unhandled request error");
  } else {
    logger.warn({ err }, "Request rejected");
  }
  // A 4xx message is safe to expose — it describes the client's own mistake.
  // A 5xx message might leak internals, so it's hidden in production.
  const exposeMessage = status < 500 || process.env.NODE_ENV === "development";
  res.status(status).json({
    error: exposeMessage ? err.message : "Something went wrong",
  });
}
