import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import argon2 from "argon2";
import { errorHandler } from "~/server/middleware/errorHandler";

vi.mock("~/server/middleware/rateLimiter", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const { getUserByEmail, updateUserPassword } = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  updateUserPassword: vi.fn(),
}));
vi.mock("~/server/util/routes/user", () => ({
  getUserByEmail,
  updateUserPassword,
}));

const { invalidateAllSessionsForUser } = vi.hoisted(() => ({
  invalidateAllSessionsForUser: vi.fn(),
}));
vi.mock("~/server/util/sessionRegistry", () => ({
  invalidateAllSessionsForUser,
}));

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("~/server/util/mailing", () => ({
  sendEmail,
  escapeHtml: (s: string) => s,
}));

const { findOneBy, insert, update, del } = vi.hoisted(() => ({
  findOneBy: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ findOneBy, insert, update, delete: del })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

const { router } = await import("~/server/routes/passwordReset");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", router);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  getUserByEmail.mockReset();
  updateUserPassword.mockReset().mockResolvedValue(undefined);
  invalidateAllSessionsForUser.mockReset().mockResolvedValue(undefined);
  sendEmail.mockReset().mockResolvedValue(undefined);
  findOneBy.mockReset();
  insert.mockReset().mockResolvedValue(undefined);
  update.mockReset().mockResolvedValue(undefined);
  del.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/v1/auth/forgot-password", () => {
  const GENERIC_MESSAGE =
    "If an account exists for that email, a password reset code has been sent.";

  it("rejects an invalid body", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("returns the generic message and sends nothing for an email with no real account", async () => {
    getUserByEmail.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("returns the same generic message for an invited-but-not-activated account", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "invited@example.com",
      passwordHash: "",
      userDetails: {},
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ email: "invited@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("stores a hashed code and emails it for a real, activated account", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: "some-real-hash",
      userDetails: {},
    });
    findOneBy.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/forgot-password")
      .send({ email: "a@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(insert).toHaveBeenCalledOnce();
    const insertedCode = insert.mock.calls[0][0].code;
    expect(insertedCode).not.toBe(""); // hashed, not the plain code
    expect(sendEmail).toHaveBeenCalledOnce();
  });
});

describe("POST /api/v1/auth/reset-password", () => {
  it("rejects an invalid body (short password)", async () => {
    const res = await request(buildApp())
      .post("/api/v1/auth/reset-password")
      .send({ email: "a@example.com", code: "111111", new_password: "short" });
    expect(res.status).toBe(400);
  });

  it("400s for an email with no real account", async () => {
    getUserByEmail.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/reset-password")
      .send({
        email: "nobody@example.com",
        code: "111111",
        new_password: "new-password-123",
      });
    expect(res.status).toBe(400);
    expect(updateUserPassword).not.toHaveBeenCalled();
  });

  it("400s when no reset code record exists", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: "some-real-hash",
      userDetails: {},
    });
    findOneBy.mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/api/v1/auth/reset-password")
      .send({
        email: "a@example.com",
        code: "111111",
        new_password: "new-password-123",
      });
    expect(res.status).toBe(400);
  });

  it("400s on a wrong code", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: "some-real-hash",
      userDetails: {},
    });
    findOneBy.mockResolvedValue({
      id: "code-1",
      email: "a@example.com",
      code: await argon2.hash("111111"),
      expires_at: new Date(Date.now() + 60_000),
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/reset-password")
      .send({
        email: "a@example.com",
        code: "222222",
        new_password: "new-password-123",
      });
    expect(res.status).toBe(400);
    expect(updateUserPassword).not.toHaveBeenCalled();
  });

  it("410s on an expired (but otherwise correct) code", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: "some-real-hash",
      userDetails: {},
    });
    findOneBy.mockResolvedValue({
      id: "code-1",
      email: "a@example.com",
      code: await argon2.hash("111111"),
      expires_at: new Date(Date.now() - 60_000),
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/reset-password")
      .send({
        email: "a@example.com",
        code: "111111",
        new_password: "new-password-123",
      });
    expect(res.status).toBe(410);
    expect(updateUserPassword).not.toHaveBeenCalled();
  });

  it("resets the password, consumes the code, and invalidates every session on success", async () => {
    getUserByEmail.mockResolvedValue({
      id: "user-1",
      email: "a@example.com",
      passwordHash: "some-real-hash",
      userDetails: {},
    });
    findOneBy.mockResolvedValue({
      id: "code-1",
      email: "a@example.com",
      code: await argon2.hash("111111"),
      expires_at: new Date(Date.now() + 60_000),
    });
    const res = await request(buildApp())
      .post("/api/v1/auth/reset-password")
      .send({
        email: "a@example.com",
        code: "111111",
        new_password: "new-password-123",
      });
    expect(res.status).toBe(200);
    expect(updateUserPassword).toHaveBeenCalledWith(
      "user-1",
      expect.any(String),
    );
    expect(del).toHaveBeenCalledWith({ email: "a@example.com" });
    expect(invalidateAllSessionsForUser).toHaveBeenCalledWith("a@example.com");
  });
});
