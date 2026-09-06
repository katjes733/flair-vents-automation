import { describe, it, expect, vi, beforeEach } from "vitest";

const { resolveActor } = vi.hoisted(() => ({ resolveActor: vi.fn() }));
vi.mock("~/server/util/resolveActor", () => ({ resolveActor }));

const { resolveActorMiddleware } =
  await import("~/server/middleware/resolveActorMiddleware");

function fakeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const ACTOR = {
  loginEmail: "a@example.com",
  source: "member" as const,
  installationId: "inst-1",
  role: "owner" as const,
  profile: "admin" as const,
  scope: { airHandlerIds: "*" as const },
};

beforeEach(() => {
  resolveActor.mockReset();
});

describe("resolveActorMiddleware", () => {
  it("401s when there's no session user at all", async () => {
    const req: any = { session: {}, get: () => undefined };
    const res = fakeRes();
    const next = vi.fn();
    await resolveActorMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(resolveActor).not.toHaveBeenCalled();
  });

  it("attaches the resolved actor to req.actor and calls next()", async () => {
    resolveActor.mockResolvedValue(ACTOR);
    const req: any = {
      session: { user: "a@example.com" },
      get: () => undefined,
    };
    const res = fakeRes();
    const next = vi.fn();
    await resolveActorMiddleware(req, res, next);
    expect(req.actor).toEqual(ACTOR);
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes the x-installation-id header through to resolveActor", async () => {
    resolveActor.mockResolvedValue(ACTOR);
    const req: any = {
      session: { user: "a@example.com" },
      get: (name: string) =>
        name === "x-installation-id" ? "inst-1" : undefined,
    };
    const res = fakeRes();
    await resolveActorMiddleware(req, res, vi.fn());
    expect(resolveActor).toHaveBeenCalledWith("a@example.com", "inst-1");
  });

  it("400s on an ambiguous resolution", async () => {
    resolveActor.mockResolvedValue({ error: "ambiguous" });
    const req: any = {
      session: { user: "a@example.com" },
      get: () => undefined,
    };
    const res = fakeRes();
    await resolveActorMiddleware(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("403s on no_access or not_authorized_for_installation", async () => {
    resolveActor.mockResolvedValue({ error: "no_access" });
    const req: any = {
      session: { user: "a@example.com" },
      get: () => undefined,
    };
    const res = fakeRes();
    await resolveActorMiddleware(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
