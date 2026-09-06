import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import session from "express-session";
import { errorHandler } from "~/server/middleware/errorHandler";

vi.mock("~/server/middleware/rateLimiter", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const { getUserByEmail } = vi.hoisted(() => ({ getUserByEmail: vi.fn() }));
vi.mock("~/server/util/routes/user", () => ({ getUserByEmail }));

const { getPendingSignup } = vi.hoisted(() => ({ getPendingSignup: vi.fn() }));
vi.mock("~/server/util/pendingSignup", () => ({ getPendingSignup }));

const { isLockedOut, recordFailure } = vi.hoisted(() => ({
  isLockedOut: vi.fn(),
  recordFailure: vi.fn(),
}));
vi.mock("~/server/util/authLockout", () => ({ isLockedOut, recordFailure }));

const { establishSession, buildSessionUser } = vi.hoisted(() => ({
  establishSession: vi.fn(),
  buildSessionUser: vi.fn(),
}));
vi.mock("~/server/util/sessionEstablish", () => ({
  establishSession,
  buildSessionUser,
}));

const argon2 = await import("argon2");
const { router } = await import("~/server/routes/session");

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
  app.use("/api/v1/session", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getUserByEmail.mockReset();
  getPendingSignup.mockReset().mockResolvedValue(null);
  isLockedOut.mockReset().mockResolvedValue(false);
  recordFailure.mockReset().mockResolvedValue(undefined);
  establishSession.mockReset();
  buildSessionUser.mockReset();
});

describe("POST /api/v1/session/login", () => {
  it("rejects an invalid body", async () => {
    const res = await request(buildApp())
      .post("/api/v1/session/login")
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("429s when the account is locked out", async () => {
    isLockedOut.mockResolvedValue(true);
    const res = await request(buildApp())
      .post("/api/v1/session/login")
      .send({ email: "a@example.com", password: "pw" });
    expect(res.status).toBe(429);
  });

  it("401s when no user or pending signup exists for the email", async () => {
    getUserByEmail.mockResolvedValue(null);
    getPendingSignup.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/session/login")
      .send({ email: "nobody@example.com", password: "pw" });
    expect(res.status).toBe(401);
    expect(recordFailure).toHaveBeenCalledWith("nobody@example.com");
  });

  it("401s and records a failure on a wrong password", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: await argon2.hash("correct-password"),
      userDetails: {},
    });
    const res = await request(buildApp())
      .post("/api/v1/session/login")
      .send({ email: "a@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(recordFailure).toHaveBeenCalledWith("a@example.com");
  });

  it("logs in against a pending (not-yet-materialized) signup's password", async () => {
    getUserByEmail.mockResolvedValue(null);
    getPendingSignup.mockResolvedValue({
      passwordHash: await argon2.hash("correct-password"),
    });
    establishSession.mockResolvedValue({
      message: "Logged in",
      user: { loginEmail: "a@example.com", installationLinked: false },
      sessionExpiry: 12345,
    });
    const res = await request(buildApp())
      .post("/api/v1/session/login")
      .send({ email: "a@example.com", password: "correct-password" });
    expect(res.status).toBe(200);
    expect(res.body.user.installationLinked).toBe(false);
  });

  it("establishes a real session on a correct password", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: await argon2.hash("correct-password"),
      userDetails: {},
    });
    establishSession.mockResolvedValue({
      message: "Logged in",
      user: { loginEmail: "a@example.com", installationLinked: true },
      sessionExpiry: 12345,
    });
    const res = await request(buildApp())
      .post("/api/v1/session/login")
      .send({ email: "a@example.com", password: "correct-password" });
    expect(res.status).toBe(200);
    expect(establishSession).toHaveBeenCalledOnce();
  });
});

describe("GET /api/v1/session/me", () => {
  it("401s with no session", async () => {
    const res = await request(buildApp()).get("/api/v1/session/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/session/logout", () => {
  it("succeeds even with no active session", async () => {
    const res = await request(buildApp()).post("/api/v1/session/logout");
    expect(res.status).toBe(200);
  });
});
