import { describe, it, expect, vi, beforeEach } from "vitest";

const { startAuthentication, startRegistration, browserSupportsWebAuthn } =
  vi.hoisted(() => ({
    startAuthentication: vi.fn(),
    startRegistration: vi.fn(),
    browserSupportsWebAuthn: vi.fn(),
  }));
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
}));

const { httpClient } = vi.hoisted(() => ({
  httpClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock("~/client/api/httpClient", () => ({ httpClient }));

const { loginWithPasskey, registerPasskey, fetchPasskeys, deletePasskey } =
  await import("~/client/api/webauthnApi");

beforeEach(() => {
  httpClient.get.mockReset();
  httpClient.post.mockReset();
  httpClient.delete.mockReset();
  startAuthentication.mockReset();
  startRegistration.mockReset();
});

describe("loginWithPasskey", () => {
  it("fetches options with no username hint, then verifies the assertion", async () => {
    const options = { challenge: "c1" };
    httpClient.post
      .mockResolvedValueOnce({ data: options })
      .mockResolvedValueOnce({
        data: { message: "Logged in", user: null, sessionExpiry: 1 },
      });
    startAuthentication.mockResolvedValue({ id: "cred-1" });

    const result = await loginWithPasskey();

    expect(httpClient.post).toHaveBeenNthCalledWith(
      1,
      "/webauthn/login/options",
    );
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
    expect(httpClient.post).toHaveBeenNthCalledWith(
      2,
      "/webauthn/login/verify",
      { id: "cred-1" },
    );
    expect(result.message).toBe("Logged in");
  });
});

describe("registerPasskey", () => {
  it("passes the nickname through to both the options and verify calls", async () => {
    const options = { challenge: "c1" };
    httpClient.post
      .mockResolvedValueOnce({ data: options })
      .mockResolvedValueOnce({ data: { verified: true } });
    startRegistration.mockResolvedValue({ id: "cred-1" });

    await registerPasskey("My Phone");

    expect(httpClient.post).toHaveBeenNthCalledWith(
      1,
      "/webauthn/register/options",
      { nickname: "My Phone" },
    );
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
    expect(httpClient.post).toHaveBeenNthCalledWith(
      2,
      "/webauthn/register/verify",
      { id: "cred-1", nickname: "My Phone" },
    );
  });

  it("works with no nickname at all", async () => {
    httpClient.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: { verified: true } });
    startRegistration.mockResolvedValue({ id: "cred-1" });

    await registerPasskey();

    expect(httpClient.post).toHaveBeenNthCalledWith(
      1,
      "/webauthn/register/options",
      { nickname: undefined },
    );
  });
});

describe("fetchPasskeys / deletePasskey", () => {
  it("unwraps the credentials array", async () => {
    httpClient.get.mockResolvedValue({
      data: { credentials: [{ id: "1", nickname: "Phone" }] },
    });
    const result = await fetchPasskeys();
    expect(httpClient.get).toHaveBeenCalledWith("/webauthn/credentials");
    expect(result).toEqual([{ id: "1", nickname: "Phone" }]);
  });

  it("deletes by id", async () => {
    httpClient.delete.mockResolvedValue({ data: {} });
    await deletePasskey("cred-1");
    expect(httpClient.delete).toHaveBeenCalledWith(
      "/webauthn/credentials/cred-1",
    );
  });
});
