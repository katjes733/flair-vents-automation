import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTokenWithClientCredentials,
  getTokenWithAuthorizationCode,
  getTokenWithRefreshToken,
  buildFlairAuthorizeUrl,
  getEnvFlairCredentials,
} from "~/server/util/auth";

function fakeResponse(): Response {
  return new Response(null, { status: 200 });
}

const CREDENTIALS = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
};

describe("getEnvFlairCredentials", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when FLAIR_CLIENT_ID or FLAIR_CLIENT_SECRET is missing", () => {
    delete process.env.FLAIR_CLIENT_ID;
    process.env.FLAIR_CLIENT_SECRET = "secret";
    expect(() => getEnvFlairCredentials()).toThrow(/FLAIR_CLIENT_ID/);
  });

  it("returns the configured pair when both are set", () => {
    process.env.FLAIR_CLIENT_ID = "env-id";
    process.env.FLAIR_CLIENT_SECRET = "env-secret";
    expect(getEnvFlairCredentials()).toEqual({
      clientId: "env-id",
      clientSecret: "env-secret",
    });
  });
});

describe("auth grant callers", () => {
  const originalEnv = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.FLAIR_API_BASE_URL = "https://api.flair.test";
    delete process.env.FLAIR_SCOPE;
    fetchMock = vi.fn().mockResolvedValue(fakeResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("posts client_credentials with the passed-in client id/secret in the body", async () => {
    await getTokenWithClientCredentials(CREDENTIALS);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.flair.test/oauth2/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
  });

  it("includes scope in the body when FLAIR_SCOPE is set", async () => {
    process.env.FLAIR_SCOPE = "vents.view vents.edit";
    await getTokenWithClientCredentials(CREDENTIALS);
    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("scope")).toBe("vents.view vents.edit");
  });

  it("posts authorization_code with the code and redirect_uri", async () => {
    await getTokenWithAuthorizationCode(
      CREDENTIALS,
      "the-code",
      "https://app.test/callback",
    );
    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe("https://app.test/callback");
  });

  it("posts refresh_token with the refresh token", async () => {
    await getTokenWithRefreshToken(CREDENTIALS, "the-refresh-token");
    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("the-refresh-token");
  });

  it("builds an authorize URL with response_type, client_id, redirect_uri and state", () => {
    const url = buildFlairAuthorizeUrl(CREDENTIALS, {
      redirectUri: "https://app.test/callback",
      state: "abc123",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://api.flair.test");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://app.test/callback",
    );
    expect(parsed.searchParams.get("state")).toBe("abc123");
  });
});
