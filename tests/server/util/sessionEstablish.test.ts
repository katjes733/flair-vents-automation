import { describe, it, expect, vi, beforeEach } from "vitest";

const { resolveActor } = vi.hoisted(() => ({ resolveActor: vi.fn() }));
vi.mock("~/server/util/resolveActor", () => ({ resolveActor }));

const { clearLockout } = vi.hoisted(() => ({ clearLockout: vi.fn() }));
vi.mock("~/server/util/authLockout", () => ({ clearLockout }));

const { getInstallationById } = vi.hoisted(() => ({
  getInstallationById: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({ getInstallationById }));

const { registerSession } = vi.hoisted(() => ({ registerSession: vi.fn() }));
vi.mock("~/server/util/sessionRegistry", () => ({ registerSession }));

const { buildSessionUser, establishSession } =
  await import("~/server/util/sessionEstablish");

beforeEach(() => {
  resolveActor.mockReset();
  clearLockout.mockReset().mockResolvedValue(undefined);
  registerSession.mockReset().mockResolvedValue(undefined);
  getInstallationById.mockReset().mockResolvedValue({
    id: "inst-1",
    name: "Martin's Home",
    flairStructureId: "s1",
  });
});

describe("buildSessionUser", () => {
  it("reports installationLinked: false for a no_access resolution (mid-signup)", async () => {
    resolveActor.mockResolvedValue({ error: "no_access" });
    const result = await buildSessionUser("a@example.com");
    expect(result).toMatchObject({
      loginEmail: "a@example.com",
      installationLinked: false,
    });
  });

  it("returns null for any other resolution error", async () => {
    resolveActor.mockResolvedValue({ error: "ambiguous" });
    expect(await buildSessionUser("a@example.com")).toBeNull();
  });

  it("reports the resolved installation/role/profile when linked, including the installation's name", async () => {
    resolveActor.mockResolvedValue({
      loginEmail: "a@example.com",
      installationId: "inst-1",
      role: "owner",
      profile: "admin",
      scope: { airHandlerIds: "*" },
      source: "member",
    });
    const result = await buildSessionUser("a@example.com");
    expect(getInstallationById).toHaveBeenCalledWith("inst-1");
    expect(result).toEqual({
      loginEmail: "a@example.com",
      installationId: "inst-1",
      installationName: "Martin's Home",
      role: "owner",
      profile: "admin",
      installationLinked: true,
    });
  });

  it("falls back to a null installation name if the installation lookup somehow comes back empty", async () => {
    resolveActor.mockResolvedValue({
      loginEmail: "a@example.com",
      installationId: "inst-1",
      role: "owner",
      profile: "admin",
      scope: { airHandlerIds: "*" },
      source: "member",
    });
    getInstallationById.mockResolvedValue(null);
    const result = await buildSessionUser("a@example.com");
    expect(result).toMatchObject({ installationName: null });
  });
});

describe("establishSession", () => {
  function fakeReq() {
    return {
      sessionID: "sid-1",
      session: { cookie: { maxAge: 4 * 60 * 60 * 1000 } },
    } as any;
  }

  it("clears any lockout, sets the session's login identity, and registers the session id", async () => {
    resolveActor.mockResolvedValue({ error: "no_access" });
    const req = fakeReq();
    await establishSession(req, "a@example.com");
    expect(clearLockout).toHaveBeenCalledWith("a@example.com");
    expect(req.session.user).toBe("a@example.com");
    expect(registerSession).toHaveBeenCalledWith("a@example.com", "sid-1");
  });

  it("sets a session expiry only if one isn't already present", async () => {
    resolveActor.mockResolvedValue({ error: "no_access" });
    const req = fakeReq();
    await establishSession(req, "a@example.com");
    expect(typeof req.session.expiry).toBe("number");

    const existingExpiry = 12345;
    const req2 = fakeReq();
    req2.session.expiry = existingExpiry;
    await establishSession(req2, "a@example.com");
    expect(req2.session.expiry).toBe(existingExpiry);
  });
});
