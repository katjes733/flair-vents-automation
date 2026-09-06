import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("~/server/middleware/rateLimiter", () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

const { getUserByEmail, getUserById } = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
}));
vi.mock("~/server/util/routes/user", () => ({ getUserByEmail, getUserById }));

const {
  create: mockCreate,
  findByCredentialId: mockFindByCredentialId,
  findByUserId: mockFindByUserId,
  recordUse: mockRecordUse,
  deleteForUser: mockDeleteForUser,
} = vi.hoisted(() => ({
  create: vi.fn(),
  findByCredentialId: vi.fn(),
  findByUserId: vi.fn(),
  recordUse: vi.fn(),
  deleteForUser: vi.fn(),
}));
vi.mock("~/server/util/routes/webauthnCredential", () => ({
  create: mockCreate,
  findByCredentialId: mockFindByCredentialId,
  findByUserId: mockFindByUserId,
  recordUse: mockRecordUse,
  deleteForUser: mockDeleteForUser,
}));

const { isLockedOut: mockIsLockedOut, recordFailure: mockRecordFailure } =
  vi.hoisted(() => ({ isLockedOut: vi.fn(), recordFailure: vi.fn() }));
vi.mock("~/server/util/authLockout", () => ({
  isLockedOut: mockIsLockedOut,
  recordFailure: mockRecordFailure,
}));

const { establishSession: mockEstablishSession } = vi.hoisted(() => ({
  establishSession: vi.fn(),
}));
vi.mock("~/server/util/sessionEstablish", () => ({
  establishSession: mockEstablishSession,
}));

const { sendEmail: mockSendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));
vi.mock("~/server/util/mailing", () => ({
  sendEmail: mockSendEmail,
  escapeHtml: (s: string) => s,
}));

const { getWebauthnConfig: mockGetWebauthnConfig } = vi.hoisted(() => ({
  getWebauthnConfig: vi.fn(),
}));
vi.mock("~/server/util/requestOrigin", () => ({
  getWebauthnConfig: mockGetWebauthnConfig,
}));

const {
  generateRegistrationOptions: mockGenerateRegistrationOptions,
  verifyRegistrationResponse: mockVerifyRegistrationResponse,
  generateAuthenticationOptions: mockGenerateAuthenticationOptions,
  verifyAuthenticationResponse: mockVerifyAuthenticationResponse,
} = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mockGenerateRegistrationOptions,
  verifyRegistrationResponse: mockVerifyRegistrationResponse,
  generateAuthenticationOptions: mockGenerateAuthenticationOptions,
  verifyAuthenticationResponse: mockVerifyAuthenticationResponse,
}));

const { router } = await import("~/server/routes/webauthn");

function buildApp(session: { user?: string; webauthnChallenge?: string } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { ...session };
    next();
  });
  app.use("/api/v1/webauthn", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetWebauthnConfig.mockReturnValue({
    rpID: "example.com",
    expectedOrigin: ["https://example.com"],
  });
  mockIsLockedOut.mockResolvedValue(false);
});

describe("POST /register/options", () => {
  it("401s when not authenticated", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/v1/webauthn/register/options");
    expect(res.status).toBe(401);
  });

  it("returns registration options and excludes existing credentials", async () => {
    getUserByEmail.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockFindByUserId.mockResolvedValue([
      { credential_id: "cred-1", transports: ["internal"] },
    ]);
    mockGenerateRegistrationOptions.mockResolvedValue({
      challenge: "the-challenge",
    });

    const app = buildApp({ user: "owner@example.com" });
    const res = await request(app)
      .post("/api/v1/webauthn/register/options")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: "the-challenge" });
    expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: "example.com",
        userName: "owner@example.com",
        excludeCredentials: [{ id: "cred-1", transports: ["internal"] }],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      }),
    );
  });
});

describe("POST /register/verify", () => {
  it("400s when there is no registration challenge in progress", async () => {
    getUserByEmail.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    const app = buildApp({ user: "owner@example.com" });
    const res = await request(app)
      .post("/api/v1/webauthn/register/verify")
      .send({
        id: "cred-id",
        rawId: "cred-id",
        type: "public-key",
        response: { clientDataJSON: "x", attestationObject: "y" },
        clientExtensionResults: {},
      });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("persists the credential and emails the owner on success", async () => {
    getUserByEmail.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockVerifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-1",
          publicKey: new Uint8Array([1, 2, 3]),
          transports: ["internal"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    });

    const app = buildApp({
      user: "owner@example.com",
      webauthnChallenge: "the-challenge",
    });
    const res = await request(app)
      .post("/api/v1/webauthn/register/verify")
      .send({
        id: "cred-1",
        rawId: "cred-1",
        type: "public-key",
        response: { clientDataJSON: "x", attestationObject: "y" },
        clientExtensionResults: {},
        nickname: "iPhone",
      });

    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        credentialId: "cred-1",
        deviceType: "multiDevice",
        backedUp: true,
        nickname: "iPhone",
      }),
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "owner@example.com",
      true,
      expect.any(String),
    );
  });

  it("400s when the assertion doesn't verify", async () => {
    getUserByEmail.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockVerifyRegistrationResponse.mockResolvedValue({ verified: false });
    const app = buildApp({
      user: "owner@example.com",
      webauthnChallenge: "the-challenge",
    });
    const res = await request(app)
      .post("/api/v1/webauthn/register/verify")
      .send({
        id: "cred-1",
        rawId: "cred-1",
        type: "public-key",
        response: { clientDataJSON: "x", attestationObject: "y" },
        clientExtensionResults: {},
      });
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("POST /login/options", () => {
  it("returns discoverable authentication options with no allowCredentials", async () => {
    mockGenerateAuthenticationOptions.mockResolvedValue({
      challenge: "login-challenge",
    });
    const app = buildApp();
    const res = await request(app).post("/api/v1/webauthn/login/options");
    expect(res.status).toBe(200);
    expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: "example.com",
      userVerification: "required",
    });
  });
});

describe("POST /login/verify", () => {
  const assertion = {
    id: "cred-1",
    rawId: "cred-1",
    type: "public-key",
    response: {
      clientDataJSON: "x",
      authenticatorData: "y",
      signature: "z",
    },
    clientExtensionResults: {},
  };

  it("400s when there is no login challenge in progress", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/v1/webauthn/login/verify")
      .send(assertion);
    expect(res.status).toBe(400);
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("401s when the credential is not recognized", async () => {
    mockFindByCredentialId.mockResolvedValue(null);
    const app = buildApp({ webauthnChallenge: "the-challenge" });
    const res = await request(app)
      .post("/api/v1/webauthn/login/verify")
      .send(assertion);
    expect(res.status).toBe(401);
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("429s when the resolved account is locked out", async () => {
    mockFindByCredentialId.mockResolvedValue({
      id: "row-1",
      user_id: "u1",
      credential_id: "cred-1",
      public_key: Buffer.from("key").toString("base64url"),
      sign_counter: 0,
      transports: null,
    });
    getUserById.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockIsLockedOut.mockResolvedValue(true);

    const app = buildApp({ webauthnChallenge: "the-challenge" });
    const res = await request(app)
      .post("/api/v1/webauthn/login/verify")
      .send(assertion);
    expect(res.status).toBe(429);
    expect(mockVerifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("401s and records a failure when the assertion doesn't verify", async () => {
    mockFindByCredentialId.mockResolvedValue({
      id: "row-1",
      user_id: "u1",
      credential_id: "cred-1",
      public_key: Buffer.from("key").toString("base64url"),
      sign_counter: 0,
      transports: null,
    });
    getUserById.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockVerifyAuthenticationResponse.mockResolvedValue({ verified: false });

    const app = buildApp({ webauthnChallenge: "the-challenge" });
    const res = await request(app)
      .post("/api/v1/webauthn/login/verify")
      .send(assertion);
    expect(res.status).toBe(401);
    expect(mockRecordFailure).toHaveBeenCalledWith("owner@example.com");
    expect(mockEstablishSession).not.toHaveBeenCalled();
  });

  it("establishes a session and records credential use on success", async () => {
    mockFindByCredentialId.mockResolvedValue({
      id: "row-1",
      user_id: "u1",
      credential_id: "cred-1",
      public_key: Buffer.from("key").toString("base64url"),
      sign_counter: 0,
      transports: null,
    });
    getUserById.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockVerifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 7 },
    });
    mockEstablishSession.mockResolvedValue({
      message: "Logged in",
      user: { loginEmail: "owner@example.com" },
      sessionExpiry: 123,
    });

    const app = buildApp({ webauthnChallenge: "the-challenge" });
    const res = await request(app)
      .post("/api/v1/webauthn/login/verify")
      .send(assertion);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Logged in",
      user: { loginEmail: "owner@example.com" },
      sessionExpiry: 123,
    });
    expect(mockRecordUse).toHaveBeenCalledWith("row-1", 7);
    expect(mockEstablishSession).toHaveBeenCalledWith(
      expect.anything(),
      "owner@example.com",
    );
  });
});

describe("GET /credentials", () => {
  it("401s when not authenticated", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/v1/webauthn/credentials");
    expect(res.status).toBe(401);
  });

  it("lists the current user's credentials", async () => {
    getUserByEmail.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockFindByUserId.mockResolvedValue([
      {
        id: "row-1",
        credential_id: "cred-1",
        nickname: "iPhone",
        device_type: "multiDevice",
        backed_up: true,
        transports: ["internal"],
        creation_time: new Date("2026-01-01"),
        last_used_at: null,
      },
    ]);
    const app = buildApp({ user: "owner@example.com" });
    const res = await request(app).get("/api/v1/webauthn/credentials");
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([
      expect.objectContaining({ id: "row-1", nickname: "iPhone" }),
    ]);
  });
});

describe("DELETE /credentials/:id", () => {
  it("401s when not authenticated", async () => {
    const app = buildApp();
    const res = await request(app).delete("/api/v1/webauthn/credentials/row-1");
    expect(res.status).toBe(401);
  });

  it("404s when the credential doesn't exist or belongs to someone else", async () => {
    getUserByEmail.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockDeleteForUser.mockResolvedValue(null);
    const app = buildApp({ user: "owner@example.com" });
    const res = await request(app).delete("/api/v1/webauthn/credentials/row-1");
    expect(res.status).toBe(404);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("deletes an owned credential and sends a notification email", async () => {
    getUserByEmail.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    mockDeleteForUser.mockResolvedValue({ id: "row-1", nickname: "iPhone" });
    const app = buildApp({ user: "owner@example.com" });
    const res = await request(app).delete("/api/v1/webauthn/credentials/row-1");
    expect(res.status).toBe(200);
    expect(mockDeleteForUser).toHaveBeenCalledWith("row-1", "u1");
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "owner@example.com",
      true,
      expect.any(String),
    );
  });
});
