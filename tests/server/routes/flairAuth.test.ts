import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const { getOrCreateDefaultInstallation } = vi.hoisted(() => ({
  getOrCreateDefaultInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/installation", () => ({
  getOrCreateDefaultInstallation,
}));

const { getFlairTokenByInstallation } = vi.hoisted(() => ({
  getFlairTokenByInstallation: vi.fn(),
}));
vi.mock("~/server/util/routes/flairToken", () => ({
  getFlairTokenByInstallation,
}));

const { buildFlairAuthorizeUrl } = vi.hoisted(() => ({
  buildFlairAuthorizeUrl: vi.fn(),
}));
vi.mock("~/server/util/auth", () => ({ buildFlairAuthorizeUrl }));

const { redisSet } = vi.hoisted(() => ({ redisSet: vi.fn() }));
vi.mock("~/server/util/redis", () => ({ redis: { set: redisSet } }));

const { router } = await import("~/server/routes/flairAuth");

function buildApp() {
  const app = express();
  app.use("/api/v1/flair-auth", router);
  return app;
}

describe("GET /api/v1/flair-auth/status", () => {
  beforeEach(() => {
    getOrCreateDefaultInstallation
      .mockReset()
      .mockResolvedValue({ id: "inst-1", name: "Home" });
    getFlairTokenByInstallation.mockReset();
  });

  it("reports not authenticated when no token is stored", async () => {
    getFlairTokenByInstallation.mockResolvedValue(null);
    const res = await request(buildApp()).get("/api/v1/flair-auth/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it("reports authenticated when a token exists with no recorded refresh error", async () => {
    getFlairTokenByInstallation.mockResolvedValue({
      accessToken: "at",
      scope: "vents.edit",
      expiresAt: null,
      lastRefreshError: null,
      lastRefreshErrorAt: null,
    });
    const res = await request(buildApp()).get("/api/v1/flair-auth/status");
    expect(res.body.authenticated).toBe(true);
    expect(res.body.scope).toBe("vents.edit");
  });

  it("reports not authenticated (needs re-auth) when a refresh error is recorded", async () => {
    getFlairTokenByInstallation.mockResolvedValue({
      accessToken: "at",
      scope: null,
      expiresAt: null,
      lastRefreshError: "invalid_grant",
      lastRefreshErrorAt: new Date(),
    });
    const res = await request(buildApp()).get("/api/v1/flair-auth/status");
    expect(res.body.authenticated).toBe(false);
    expect(res.body.lastRefreshError).toBe("invalid_grant");
  });
});

describe("GET /api/v1/flair-auth/authorize", () => {
  const originalEnv = process.env.FLAIR_GRANT_MODE;

  beforeEach(() => {
    getOrCreateDefaultInstallation
      .mockReset()
      .mockResolvedValue({ id: "inst-1", name: "Home" });
    redisSet.mockReset().mockResolvedValue("OK");
    buildFlairAuthorizeUrl
      .mockReset()
      .mockReturnValue("https://api.flair.co/oauth2/authorize?mock=1");
  });

  afterEach(() => {
    process.env.FLAIR_GRANT_MODE = originalEnv;
  });

  it("rejects with 400 when FLAIR_GRANT_MODE isn't authorization_code", async () => {
    process.env.FLAIR_GRANT_MODE = "client_credentials";
    const res = await request(buildApp()).get("/api/v1/flair-auth/authorize");
    expect(res.status).toBe(400);
    expect(redisSet).not.toHaveBeenCalled();
  });

  it("stores state in Redis with a 10-minute TTL and redirects to the authorize URL", async () => {
    process.env.FLAIR_GRANT_MODE = "authorization_code";
    const res = await request(buildApp()).get("/api/v1/flair-auth/authorize");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      "https://api.flair.co/oauth2/authorize?mock=1",
    );
    expect(redisSet).toHaveBeenCalledWith(
      expect.stringMatching(/^oauth:state:/),
      expect.any(String),
      "EX",
      600,
    );
  });
});
