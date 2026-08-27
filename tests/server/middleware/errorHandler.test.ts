import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";
import { errorHandler } from "~/server/middleware/errorHandler";
import { HttpError } from "~/server/util/httpError";
import { logSpy } from "../../setup";

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("errorHandler", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("responds with an HttpError's own status and exposes its message", () => {
    process.env.NODE_ENV = "production";
    const res = mockRes();
    errorHandler(
      new HttpError("origin not allowed", 403),
      {} as Request,
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "origin not allowed" });
  });

  it("logs a 4xx HttpError at warn, not error", () => {
    const res = mockRes();
    errorHandler(new HttpError("bad input", 400), {} as Request, res, vi.fn());
    expect(logSpy("warn")).toHaveBeenCalled();
    expect(logSpy("error")).not.toHaveBeenCalled();
  });

  it("treats a plain Error as a 500 and hides its message in production", () => {
    process.env.NODE_ENV = "production";
    const res = mockRes();
    errorHandler(
      new Error("db connection string leaked here"),
      {} as Request,
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Something went wrong" });
  });

  it("logs a plain (500) Error at error level, not warn", () => {
    const res = mockRes();
    errorHandler(new Error("boom"), {} as Request, res, vi.fn());
    expect(logSpy("error")).toHaveBeenCalled();
    expect(logSpy("warn")).not.toHaveBeenCalled();
  });

  it("exposes the real message for a 500 in development, for debuggability", () => {
    process.env.NODE_ENV = "development";
    const res = mockRes();
    errorHandler(new Error("boom"), {} as Request, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ error: "boom" });
  });
});
