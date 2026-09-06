import { describe, it, expect, vi } from "vitest";
import { requireAuth } from "~/server/middleware/auth";

function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireAuth", () => {
  it("401s when no session user is present", () => {
    const req: any = { session: {} };
    const res = fakeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when a session user is present", () => {
    const req: any = { session: { user: "a@example.com" } };
    const res = fakeRes();
    const next = vi.fn();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
