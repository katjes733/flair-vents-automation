import { describe, it, expect, vi } from "vitest";
import {
  validateOAuthState,
  exchangeAndSaveToken,
} from "~/server/util/oauthCallback";

describe("validateOAuthState", () => {
  const now = 1_000_000;
  const stored = {
    value: "the-state",
    installationId: "inst-1",
    expiresAt: now + 1000,
  };

  it("rejects when code or state is missing from the query", () => {
    expect(validateOAuthState({ state: "x" }, stored, now)).toEqual({
      ok: false,
      code: "missing_params",
    });
    expect(validateOAuthState({ code: "x" }, stored, now)).toEqual({
      ok: false,
      code: "missing_params",
    });
  });

  it("rejects when nothing is stored for that state (state_expired)", () => {
    expect(
      validateOAuthState({ code: "c", state: "s" }, undefined, now),
    ).toEqual({ ok: false, code: "state_expired" });
  });

  it("rejects when the query state doesn't match the stored value", () => {
    expect(
      validateOAuthState({ code: "c", state: "wrong" }, stored, now),
    ).toEqual({ ok: false, code: "invalid_state" });
  });

  it("rejects when the stored state has expired", () => {
    expect(
      validateOAuthState({ code: "c", state: "the-state" }, stored, now + 2000),
    ).toEqual({
      ok: false,
      code: "expired",
    });
  });

  it("accepts a matching, unexpired state and returns the installationId", () => {
    expect(
      validateOAuthState({ code: "c", state: "the-state" }, stored, now),
    ).toEqual({
      ok: true,
      installationId: "inst-1",
    });
  });
});

describe("exchangeAndSaveToken", () => {
  const baseOpts = {
    code: "the-code",
    redirectUri: "https://app.test/callback",
    installationId: "inst-1",
  };

  it("reports exchange_failed when the token endpoint returns a non-ok response", async () => {
    const onError = vi.fn();
    const result = await exchangeAndSaveToken({
      ...baseOpts,
      getToken: async () => new Response("bad request", { status: 400 }),
      saveToken: vi.fn(),
      onError,
    });
    expect(result).toEqual({ ok: false, code: "exchange_failed" });
    expect(onError).toHaveBeenCalledWith("exchange_failed", "bad request");
  });

  it("reports exchange_failed when the fetch itself throws", async () => {
    const onError = vi.fn();
    const result = await exchangeAndSaveToken({
      ...baseOpts,
      getToken: async () => {
        throw new Error("network down");
      },
      saveToken: vi.fn(),
      onError,
    });
    expect(result).toEqual({ ok: false, code: "exchange_failed" });
  });

  it("reports save_failed when saveToken rejects, but still parsed the token response", async () => {
    const onError = vi.fn();
    const saveToken = vi.fn().mockRejectedValue(new Error("db down"));
    const result = await exchangeAndSaveToken({
      ...baseOpts,
      getToken: async () =>
        new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      saveToken,
      onError,
    });
    expect(result).toEqual({ ok: false, code: "save_failed" });
    expect(onError).toHaveBeenCalledWith("save_failed", expect.any(Error));
  });

  it("saves the access token, refresh token, computed expiry, and scope on success", async () => {
    const saveToken = vi.fn().mockResolvedValue(undefined);
    const before = Date.now();
    const result = await exchangeAndSaveToken({
      ...baseOpts,
      getToken: async () =>
        new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            scope: "vents.edit",
          }),
          { status: 200 },
        ),
      saveToken,
      onError: vi.fn(),
    });
    expect(result).toEqual({ ok: true });
    expect(saveToken).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        accessToken: "at",
        refreshToken: "rt",
        scope: "vents.edit",
      }),
    );
    const savedExpiresAt = (
      saveToken.mock.calls[0][0] as { expiresAt: Date }
    ).expiresAt.getTime();
    expect(savedExpiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it("saves a null refreshToken/scope when the token response omits them", async () => {
    const saveToken = vi.fn().mockResolvedValue(undefined);
    await exchangeAndSaveToken({
      ...baseOpts,
      getToken: async () =>
        new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), {
          status: 200,
        }),
      saveToken,
      onError: vi.fn(),
    });
    expect(saveToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: null, scope: null }),
    );
  });
});
