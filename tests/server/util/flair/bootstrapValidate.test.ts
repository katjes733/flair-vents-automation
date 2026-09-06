import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getTokenWithClientCredentials } = vi.hoisted(() => ({
  getTokenWithClientCredentials: vi.fn(),
}));
vi.mock("~/server/util/auth", () => ({ getTokenWithClientCredentials }));

const { validateFlairCredentials } =
  await import("~/server/util/flair/bootstrapValidate");

const CREDENTIALS = { clientId: "cid", clientSecret: "csecret" };

function tokenResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function structuresResponse(
  structures: Array<{ id: string; name: string }>,
): Response {
  return new Response(
    JSON.stringify({
      data: structures.map((s) => ({ id: s.id, attributes: { name: s.name } })),
    }),
    { status: 200 },
  );
}

describe("validateFlairCredentials", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getTokenWithClientCredentials.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects with a clear message when the token mint itself fails (bad credentials)", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      new Response("bad", { status: 401 }),
    );
    await expect(validateFlairCredentials(CREDENTIALS)).rejects.toThrow(
      /didn't work/,
    );
  });

  it("rejects when the token mint call itself throws (network failure)", async () => {
    getTokenWithClientCredentials.mockRejectedValue(new Error("network down"));
    await expect(validateFlairCredentials(CREDENTIALS)).rejects.toThrow(
      /Couldn't reach Flair/,
    );
  });

  it("rejects when zero structures are found", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      tokenResponse({ access_token: "at", expires_in: 3600 }),
    );
    fetchMock.mockResolvedValue(structuresResponse([]));
    await expect(validateFlairCredentials(CREDENTIALS)).rejects.toThrow(
      /No Flair structures/,
    );
  });

  it("rejects when more than one structure is found", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      tokenResponse({ access_token: "at", expires_in: 3600 }),
    );
    fetchMock.mockResolvedValue(
      structuresResponse([
        { id: "s1", name: "Upstairs" },
        { id: "s2", name: "Downstairs" },
      ]),
    );
    await expect(validateFlairCredentials(CREDENTIALS)).rejects.toThrow(
      /Multiple Flair structures/,
    );
  });

  it("resolves with the access token, expiry, scope, and the single structure on success", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      tokenResponse({
        access_token: "at-1",
        expires_in: 3600,
        scope: "vents.edit",
      }),
    );
    fetchMock.mockResolvedValue(
      structuresResponse([{ id: "s1", name: "Upstairs" }]),
    );
    const result = await validateFlairCredentials(CREDENTIALS);
    expect(result.accessToken).toBe("at-1");
    expect(result.scope).toBe("vents.edit");
    expect(result.structure).toEqual({
      id: "s1",
      name: "Upstairs",
      timeZone: null,
    });
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("sends the minted access token as a Bearer header when fetching structures", async () => {
    getTokenWithClientCredentials.mockResolvedValue(
      tokenResponse({ access_token: "at-secret", expires_in: 3600 }),
    );
    fetchMock.mockResolvedValue(
      structuresResponse([{ id: "s1", name: "Upstairs" }]),
    );
    await validateFlairCredentials(CREDENTIALS);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer at-secret",
    );
  });
});
