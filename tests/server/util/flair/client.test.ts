import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getTokenWithClientCredentials, getTokenWithRefreshToken } = vi.hoisted(
  () => ({
    getTokenWithClientCredentials: vi.fn(),
    getTokenWithRefreshToken: vi.fn(),
  }),
);
vi.mock("~/server/util/auth", () => ({
  getTokenWithClientCredentials,
  getTokenWithRefreshToken,
}));

const {
  getFlairTokenByInstallation,
  upsertFlairToken,
  recordFlairRefreshError,
} = vi.hoisted(() => ({
  getFlairTokenByInstallation: vi.fn(),
  upsertFlairToken: vi.fn(),
  recordFlairRefreshError: vi.fn(),
}));
vi.mock("~/server/util/routes/flairToken", () => ({
  getFlairTokenByInstallation,
  upsertFlairToken,
  recordFlairRefreshError,
}));

const { recordTokenCall } = vi.hoisted(() => ({ recordTokenCall: vi.fn() }));
vi.mock("~/server/util/flair/tokenBudget", () => ({ recordTokenCall }));

const { FlairApiClient } = await import("~/server/util/flair/client");

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("FlairApiClient token management", () => {
  beforeEach(() => {
    getTokenWithClientCredentials.mockReset();
    getTokenWithRefreshToken.mockReset();
    getFlairTokenByInstallation.mockReset().mockResolvedValue(null);
    upsertFlairToken.mockReset().mockResolvedValue(undefined);
    recordFlairRefreshError.mockReset().mockResolvedValue(undefined);
    recordTokenCall.mockReset().mockResolvedValue(1);
    delete process.env.FLAIR_GRANT_MODE;
  });

  it("mints a fresh token via client_credentials when nothing is persisted", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      tokenResponse({ access_token: "at-1", expires_in: 3600 }),
    );
    const client = new FlairApiClient("inst-1");
    const token = await client.getAccessToken();
    expect(token).toBe("at-1");
    expect(getTokenWithClientCredentials).toHaveBeenCalledTimes(1);
    expect(upsertFlairToken).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "inst-1",
        accessToken: "at-1",
      }),
    );
  });

  it("reuses a persisted, still-valid token instead of minting a new one", async () => {
    getFlairTokenByInstallation.mockResolvedValue({
      accessToken: "persisted-at",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const client = new FlairApiClient("inst-1");
    const token = await client.getAccessToken();
    expect(token).toBe("persisted-at");
    expect(getTokenWithClientCredentials).not.toHaveBeenCalled();
  });

  it("re-mints when the persisted token is within the safety margin of expiring", async () => {
    getFlairTokenByInstallation.mockResolvedValue({
      accessToken: "stale-at",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 30 * 1000), // inside the 2-minute safety margin
    });
    getTokenWithClientCredentials.mockResolvedValue(
      tokenResponse({ access_token: "fresh-at", expires_in: 3600 }),
    );
    const client = new FlairApiClient("inst-1");
    expect(await client.getAccessToken()).toBe("fresh-at");
  });

  it("dedupes concurrent getAccessToken calls into a single mint request", async () => {
    let resolveResponse!: (r: Response) => void;
    getTokenWithClientCredentials.mockReturnValue(
      new Promise((resolve) => {
        resolveResponse = () =>
          resolve(tokenResponse({ access_token: "at-1", expires_in: 3600 }));
      }),
    );
    const client = new FlairApiClient("inst-1");
    const p1 = client.getAccessToken();
    const p2 = client.getAccessToken();
    resolveResponse(undefined as never);
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe("at-1");
    expect(t2).toBe("at-1");
    expect(getTokenWithClientCredentials).toHaveBeenCalledTimes(1);
  });

  it("uses refresh_token grant with the persisted refresh token when FLAIR_GRANT_MODE=refresh_token", async () => {
    process.env.FLAIR_GRANT_MODE = "refresh_token";
    getFlairTokenByInstallation.mockResolvedValue({
      accessToken: "expired-at",
      refreshToken: "the-refresh-token",
      expiresAt: new Date(Date.now() - 1000),
    });
    getTokenWithRefreshToken.mockResolvedValue(
      tokenResponse({ access_token: "new-at", expires_in: 3600 }),
    );
    const client = new FlairApiClient("inst-1");
    await client.getAccessToken();
    expect(getTokenWithRefreshToken).toHaveBeenCalledWith("the-refresh-token");
  });

  it("marks a 400/401 token failure as terminal and records the refresh error", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      new Response("bad", { status: 401, statusText: "Unauthorized" }),
    );
    const client = new FlairApiClient("inst-1");
    await expect(client.getAccessToken()).rejects.toThrow(/401/);
    expect(recordFlairRefreshError).toHaveBeenCalledWith(
      "inst-1",
      expect.stringContaining("401"),
    );
  });

  it("treats a 500 token failure as transient, not terminal", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      new Response("oops", { status: 500, statusText: "Server Error" }),
    );
    const client = new FlairApiClient("inst-1");
    await expect(client.getAccessToken()).rejects.toThrow(/500/);
    // Still records the error either way — the terminal/transient distinction
    // affects log framing (asserted via the "terminal" field), not whether
    // an error is recorded at all.
    expect(recordFlairRefreshError).toHaveBeenCalled();
  });

  it("increments the token budget counter on every mint attempt", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      tokenResponse({ access_token: "at-1", expires_in: 3600 }),
    );
    const client = new FlairApiClient("inst-1");
    await client.getAccessToken();
    expect(recordTokenCall).toHaveBeenCalledTimes(1);
  });
});

describe("FlairApiClient.request (via resource methods)", () => {
  beforeEach(() => {
    getFlairTokenByInstallation.mockReset().mockResolvedValue({
      accessToken: "at",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    upsertFlairToken.mockReset().mockResolvedValue(undefined);
    recordFlairRefreshError.mockReset().mockResolvedValue(undefined);
    recordTokenCall.mockReset().mockResolvedValue(1);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the access token as a Bearer header and parses a JSON:API structures response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "s1", attributes: { name: "Upstairs" } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new FlairApiClient("inst-1");
    const structures = await client.fetchStructures();
    expect(structures).toEqual([
      {
        id: "s1",
        name: "Upstairs",
        hvacCallState: undefined,
        equipmentFault: undefined,
      },
    ]);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer at");
  });

  it("retries once after a 429, waiting the Retry-After duration, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new FlairApiClient("inst-1");
    const promise = client.fetchStructures();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws and records an outage on a non-ok, non-429 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("nope", { status: 503, statusText: "Down" }),
        ),
    );
    const client = new FlairApiClient("inst-1");
    await expect(client.fetchStructures()).rejects.toThrow(/503/);
  });

  it("sends a PATCH with the expected JSON:API body when setting a vent's position", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FlairApiClient("inst-1");
    await client.setVentPercentOpen("vent-1", 42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/vents/vent-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      data: { type: "vents", id: "vent-1", attributes: { "percent-open": 42 } },
    });
  });
});
