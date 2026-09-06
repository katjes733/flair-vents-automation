import { describe, it, expect, vi } from "vitest";
import {
  requirePermission,
  requireAirHandlerScope,
  isWithinAirHandlerScope,
} from "~/server/middleware/requirePermission";
import type { Actor } from "~/server/util/actor";

function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function actorWith(overrides: Partial<Actor>): Actor {
  return {
    loginEmail: "a@example.com",
    source: "member",
    installationId: "inst-1",
    role: "read",
    profile: "read",
    scope: { airHandlerIds: "*" },
    ...overrides,
  };
}

describe("requirePermission", () => {
  it("401s when req.actor is missing", () => {
    const req: any = {};
    const res = fakeRes();
    const next = vi.fn();
    requirePermission("dashboard.zone.create")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when the actor's profile resolves the action to less than write", () => {
    const req: any = { actor: actorWith({ profile: "read" }) };
    const res = fakeRes();
    const next = vi.fn();
    requirePermission("dashboard.zone.create")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the actor's profile resolves the action to write", () => {
    const req: any = { actor: actorWith({ profile: "write" }) };
    const res = fakeRes();
    const next = vi.fn();
    requirePermission("dashboard.zone.create")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("requireAirHandlerScope", () => {
  it("401s when req.actor is missing", () => {
    const req: any = { body: {} };
    const res = fakeRes();
    requireAirHandlerScope({ bodyKey: "airHandlerId" })(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("passes through unconditionally for an unrestricted (*) scope", () => {
    const req: any = {
      actor: actorWith({ scope: { airHandlerIds: "*" } }),
      body: { airHandlerId: "ah-1" },
    };
    const res = fakeRes();
    const next = vi.fn();
    requireAirHandlerScope({ bodyKey: "airHandlerId" })(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("403s when a requested id falls outside a restricted scope", () => {
    const req: any = {
      actor: actorWith({ scope: { airHandlerIds: ["ah-1"] } }),
      body: { airHandlerId: "ah-2" },
    };
    const res = fakeRes();
    const next = vi.fn();
    requireAirHandlerScope({ bodyKey: "airHandlerId" })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes when the requested id is within a restricted scope", () => {
    const req: any = {
      actor: actorWith({ scope: { airHandlerIds: ["ah-1", "ah-2"] } }),
      body: { airHandlerId: "ah-1" },
    };
    const res = fakeRes();
    const next = vi.fn();
    requireAirHandlerScope({ bodyKey: "airHandlerId" })(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("isWithinAirHandlerScope", () => {
  it("is always true for an unrestricted (*) scope", () => {
    expect(isWithinAirHandlerScope(["ah-1", "ah-2"], "*")).toBe(true);
  });

  it("is true only when every id is within the restricted scope", () => {
    expect(isWithinAirHandlerScope(["ah-1"], ["ah-1", "ah-2"])).toBe(true);
    expect(isWithinAirHandlerScope(["ah-1", "ah-3"], ["ah-1", "ah-2"])).toBe(
      false,
    );
  });
});
