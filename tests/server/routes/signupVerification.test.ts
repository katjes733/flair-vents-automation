import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import argon2 from "argon2";
import { errorHandler } from "~/server/middleware/errorHandler";

vi.mock("~/server/middleware/rateLimiter", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const { getUserByEmail } = vi.hoisted(() => ({ getUserByEmail: vi.fn() }));
vi.mock("~/server/util/routes/user", () => ({ getUserByEmail }));

const { storePendingSignup } = vi.hoisted(() => ({
  storePendingSignup: vi.fn(),
}));
vi.mock("~/server/util/pendingSignup", () => ({ storePendingSignup }));

const { completeByoFlairSignup } = vi.hoisted(() => ({
  completeByoFlairSignup: vi.fn(),
}));
vi.mock("~/server/util/services/signupService", () => ({
  completeByoFlairSignup,
}));

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/server/util/mailing", () => ({
  sendEmail,
  escapeHtml: (s: string) => s,
}));

const { findOneBy, insert, update } = vi.hoisted(() => ({
  findOneBy: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ findOneBy, insert, update })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { router } = await import("~/server/routes/signupVerification");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getUserByEmail.mockReset();
  sendEmail.mockReset().mockResolvedValue(undefined);
  findOneBy.mockReset();
  insert.mockReset().mockResolvedValue(undefined);
  update.mockReset().mockResolvedValue(undefined);
  storePendingSignup.mockReset().mockResolvedValue(undefined);
  completeByoFlairSignup.mockReset();
});

describe("POST /api/v1/auth/send-code", () => {
  it("rejects an invalid body", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/send-code")
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("sends a code and inserts a new verification record for a brand-new email", async () => {
    getUserByEmail.mockResolvedValue(null);
    findOneBy.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/send-code")
      .send({ email: "new@example.com" });
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledOnce();
  });

  it("still reports success (without resending) for an already-completed signup", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "existing@example.com",
      passwordHash: "real-hash",
      userDetails: {},
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/send-code")
      .send({ email: "existing@example.com" });
    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still sends a code for a placeholder (invited-but-not-signed-up) row", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "invited@example.com",
      passwordHash: "",
      userDetails: {},
    });
    findOneBy.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/send-code")
      .send({ email: "invited@example.com" });
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
  });
});

describe("POST /api/v1/auth/verify-code", () => {
  it("rejects an invalid body", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/verify-code")
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("404s when no verification record exists", async () => {
    findOneBy.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/verify-code")
      .send({ email: "a@example.com", code: "123456" });
    expect(res.status).toBe(404);
  });

  it("400s on a wrong code", async () => {
    findOneBy.mockResolvedValue({
      email: "a@example.com",
      code: await argon2.hash("111111"),
      expires_at: new Date(Date.now() + 60_000),
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/verify-code")
      .send({ email: "a@example.com", code: "222222" });
    expect(res.status).toBe(400);
  });

  it("410s on an expired (but otherwise correct) code", async () => {
    findOneBy.mockResolvedValue({
      email: "a@example.com",
      code: await argon2.hash("111111"),
      expires_at: new Date(Date.now() - 60_000),
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/verify-code")
      .send({ email: "a@example.com", code: "111111" });
    expect(res.status).toBe(410);
  });

  it("200s on a correct, unexpired code", async () => {
    findOneBy.mockResolvedValue({
      email: "a@example.com",
      code: await argon2.hash("111111"),
      expires_at: new Date(Date.now() + 60_000),
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/verify-code")
      .send({ email: "a@example.com", code: "111111" });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v1/auth/signup", () => {
  it("rejects an invalid body (short password)", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/signup")
      .send({ email: "a@example.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("409s when a real (already-completed) account exists for the email", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: "real-hash",
      userDetails: {},
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/signup")
      .send({ email: "a@example.com", password: "a-real-password" });
    expect(res.status).toBe(409);
    expect(storePendingSignup).not.toHaveBeenCalled();
  });

  it("stores a pending signup (hashed password) for a brand-new email", async () => {
    getUserByEmail.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/signup")
      .send({ email: "new@example.com", password: "a-real-password" });
    expect(res.status).toBe(200);
    expect(storePendingSignup).toHaveBeenCalledOnce();
    const [email, data] = storePendingSignup.mock.calls[0];
    expect(email).toBe("new@example.com");
    expect(data.passwordHash).not.toBe("a-real-password");
  });
});

describe("POST /api/v1/auth/connect-flair", () => {
  it("rejects an invalid body", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/connect-flair")
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("propagates a validation failure as its own status code", async () => {
    const { HttpError } = await import("~/server/util/httpError");
    completeByoFlairSignup.mockRejectedValue(
      new HttpError("No pending signup found for this email.", 404),
    );
    const res = await request(buildApp())
      .post("/api/v1/auth/connect-flair")
      .send({
        email: "a@example.com",
        flairClientId: "cid",
        flairClientSecret: "csecret",
      });
    expect(res.status).toBe(404);
  });

  it("200s with the established session on success", async () => {
    completeByoFlairSignup.mockResolvedValue({
      message: "Logged in",
      user: { loginEmail: "a@example.com" },
      sessionExpiry: 12345,
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/connect-flair")
      .send({
        email: "a@example.com",
        flairClientId: "cid",
        flairClientSecret: "csecret",
      });
    expect(res.status).toBe(200);
    expect(res.body.user.loginEmail).toBe("a@example.com");
  });
});
