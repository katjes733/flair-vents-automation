import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { Request, Response } from "express";
import { validateBody } from "~/server/middleware/validateBody";

function mockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

const schema = z.object({ name: z.string().min(1) });

describe("validateBody", () => {
  it("calls next() and replaces req.body with the parsed value on success", () => {
    const req = { body: { name: "Upstairs" } } as Request;
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ name: "Upstairs" });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("responds 400 with issue details and never calls next() on failure", () => {
    const req = { body: { name: "" } } as Request;
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Invalid request body",
        details: expect.arrayContaining([
          expect.objectContaining({ path: "name" }),
        ]),
      }),
    );
  });

  it("treats a missing body as an empty object rather than throwing", () => {
    const req = {} as Request;
    const res = mockRes();
    const next = vi.fn();

    validateBody(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
