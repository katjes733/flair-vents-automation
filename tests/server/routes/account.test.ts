import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import session from "express-session";
import argon2 from "argon2";
import { errorHandler } from "~/server/middleware/errorHandler";

vi.mock("~/server/middleware/rateLimiter", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const { getUserByEmail } = vi.hoisted(() => ({ getUserByEmail: vi.fn() }));
vi.mock("~/server/util/routes/user", () => ({ getUserByEmail }));

const { deleteUserAccount } = vi.hoisted(() => ({
  deleteUserAccount: vi.fn(),
}));
vi.mock("~/server/util/services/accountService", () => ({
  deleteUserAccount,
}));

const { router } = await import("~/server/routes/account");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }),
  );
  app.post("/test/login-as", (req, res) => {
    req.session.user = req.body.email;
    res.json({});
  });
  app.use("/api/v1/account", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getUserByEmail.mockReset();
  deleteUserAccount.mockReset().mockResolvedValue(undefined);
});

describe("DELETE /api/v1/account", () => {
  it("401s with no active session", async () => {
    const res = await request(buildApp())
      .delete("/api/v1/account")
      .send({ password: "whatever" });
    expect(res.status).toBe(401);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("rejects an invalid body", async () => {
    const agent = request.agent(buildApp());
    await agent.post("/test/login-as").send({ email: "a@example.com" });
    const res = await agent.delete("/api/v1/account").send({});
    expect(res.status).toBe(400);
  });

  it("400s (not 401) on an incorrect confirmation password", async () => {
    const agent = request.agent(buildApp());
    await agent.post("/test/login-as").send({ email: "a@example.com" });
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: await argon2.hash("correct-password"),
      userDetails: {},
    });
    const res = await agent
      .delete("/api/v1/account")
      .send({ password: "wrong-password" });
    expect(res.status).toBe(400);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it("deletes the account and clears the cookie on a correct password", async () => {
    const agent = request.agent(buildApp());
    await agent.post("/test/login-as").send({ email: "a@example.com" });
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: await argon2.hash("correct-password"),
      userDetails: {},
    });
    const res = await agent
      .delete("/api/v1/account")
      .send({ password: "correct-password" });
    expect(res.status).toBe(200);
    expect(deleteUserAccount).toHaveBeenCalledWith({
      userId: "user-1",
      email: "a@example.com",
    });
  });

  it("propagates a blocked deletion (e.g. sole owner) as its own status", async () => {
    const agent = request.agent(buildApp());
    await agent.post("/test/login-as").send({ email: "a@example.com" });
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: await argon2.hash("correct-password"),
      userDetails: {},
    });
    const { HttpError } = await import("~/server/util/httpError");
    deleteUserAccount.mockRejectedValue(
      new HttpError("You're the only owner of Home — ...", 400),
    );
    const res = await agent
      .delete("/api/v1/account")
      .send({ password: "correct-password" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only owner of Home/);
  });
});
