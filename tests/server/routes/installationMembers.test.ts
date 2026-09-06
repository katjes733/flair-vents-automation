import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { errorHandler } from "~/server/middleware/errorHandler";

vi.mock("~/server/middleware/resolveActorMiddleware", () => ({
  resolveActorMiddleware: (req: any, _res: any, next: any) => {
    req.actor = {
      loginEmail: "a@example.com",
      source: "member",
      installationId: "inst-1",
      role: "owner",
      profile: "admin",
      scope: { airHandlerIds: "*" },
    };
    next();
  },
}));
vi.mock("~/server/middleware/requirePermission", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

const { getInstallationById } = vi.hoisted(() => ({
  getInstallationById: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({ getInstallationById }));

const { listMembersForInstallation } = vi.hoisted(() => ({
  listMembersForInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/installationMember", () => ({
  listMembersForInstallation,
}));

const {
  inviteMemberToInstallation,
  updateInstallationMemberRole,
  revokeInstallationMember,
} = vi.hoisted(() => ({
  inviteMemberToInstallation: vi.fn(),
  updateInstallationMemberRole: vi.fn(),
  revokeInstallationMember: vi.fn(),
}));
vi.mock("~/server/util/services/installationMemberService", () => ({
  inviteMemberToInstallation,
  updateInstallationMemberRole,
  revokeInstallationMember,
}));

const { router } = await import("~/server/routes/installationMembers");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/installation-members", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getInstallationById.mockReset().mockResolvedValue({
    id: "inst-1",
    name: "Martin's Home",
    flairStructureId: "s1",
  });
  listMembersForInstallation.mockReset();
  inviteMemberToInstallation.mockReset();
  updateInstallationMemberRole.mockReset();
  revokeInstallationMember.mockReset();
});

describe("GET /api/v1/installation-members", () => {
  it("lists members for the caller's own installation", async () => {
    listMembersForInstallation.mockResolvedValue([{ id: "member-1" }]);
    const res = await request(buildApp()).get("/api/v1/installation-members");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ members: [{ id: "member-1" }] });
    expect(listMembersForInstallation).toHaveBeenCalledWith("inst-1");
  });
});

describe("POST /api/v1/installation-members/invite", () => {
  it("rejects an invalid body", async () => {
    const res = await request(buildApp())
      .post("/api/v1/installation-members/invite")
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("invites, scoped to the caller's installation and role", async () => {
    inviteMemberToInstallation.mockResolvedValue({ id: "member-1" });
    const res = await request(buildApp())
      .post("/api/v1/installation-members/invite")
      .send({ email: "new@example.com", role: "write" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ member: { id: "member-1" } });
    expect(inviteMemberToInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        installationName: "Martin's Home",
        actorRole: "owner",
        email: "new@example.com",
        role: "write",
      }),
    );
  });

  it("propagates a service-layer rejection as its own status code", async () => {
    const { HttpError } = await import("~/server/util/httpError");
    inviteMemberToInstallation.mockRejectedValue(
      new HttpError("Only an owner can grant the owner role.", 403),
    );
    const res = await request(buildApp())
      .post("/api/v1/installation-members/invite")
      .send({ email: "new@example.com", role: "owner" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/installation-members/:id", () => {
  it("updates, scoped to the caller's installation and role", async () => {
    updateInstallationMemberRole.mockResolvedValue(undefined);
    const res = await request(buildApp())
      .patch("/api/v1/installation-members/member-1")
      .send({ role: "read" });
    expect(res.status).toBe(200);
    expect(updateInstallationMemberRole).toHaveBeenCalledWith({
      installationId: "inst-1",
      actorRole: "owner",
      memberId: "member-1",
      role: "read",
      scope: undefined,
    });
  });

  it("propagates a 404 for a cross-installation member id", async () => {
    const { HttpError } = await import("~/server/util/httpError");
    updateInstallationMemberRole.mockRejectedValue(
      new HttpError("Member member-1 not found.", 404),
    );
    const res = await request(buildApp())
      .patch("/api/v1/installation-members/member-1")
      .send({ role: "read" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/installation-members/:id", () => {
  it("revokes, scoped to the caller's installation", async () => {
    revokeInstallationMember.mockResolvedValue(undefined);
    const res = await request(buildApp()).delete(
      "/api/v1/installation-members/member-1",
    );
    expect(res.status).toBe(204);
    expect(revokeInstallationMember).toHaveBeenCalledWith({
      installationId: "inst-1",
      memberId: "member-1",
    });
  });

  it("propagates a rejection (e.g. last-owner protection) as its own status code", async () => {
    const { HttpError } = await import("~/server/util/httpError");
    revokeInstallationMember.mockRejectedValue(
      new HttpError("This installation must have at least one owner.", 400),
    );
    const res = await request(buildApp()).delete(
      "/api/v1/installation-members/member-1",
    );
    expect(res.status).toBe(400);
  });
});
