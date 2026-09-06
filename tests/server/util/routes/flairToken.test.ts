import { describe, it, expect, vi, beforeEach } from "vitest";

const { findOne, insert, update } = vi.hoisted(() => ({
  findOne: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
const { getRepository } = vi.hoisted(() => ({
  getRepository: vi.fn(() => ({ findOne, insert, update })),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ getRepository }) },
}));

process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);

const {
  upsertFlairToken,
  getFlairTokenByInstallation,
  recordFlairRefreshError,
  resolveFlairCredentials,
  setFlairCredentials,
} = await import("~/server/util/routes/flairToken");

describe("flairToken accessor", () => {
  beforeEach(() => {
    findOne.mockReset();
    insert.mockReset().mockResolvedValue(undefined);
    update.mockReset().mockResolvedValue(undefined);
  });

  it("inserts a new row when none exists for the installation", async () => {
    findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      id: "row-1",
      installation_id: "inst-1",
      access_token: "enc-placeholder",
      refresh_token: null,
      expires_at: new Date(),
      scope: null,
      modified_time: new Date(),
      last_refresh_error: null,
      last_refresh_error_at: null,
    });

    await upsertFlairToken({
      installationId: "inst-1",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(),
      scope: "vents.edit",
    });

    expect(insert).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    const inserted = insert.mock.calls[0][0];
    expect(inserted.installation_id).toBe("inst-1");
    // Never stores the plaintext token, encrypted or not detectable as raw.
    expect(inserted.access_token).not.toBe("at");
  });

  it("updates the existing row (clearing prior refresh-error fields) when one already exists", async () => {
    findOne
      .mockResolvedValueOnce({ id: "row-1", installation_id: "inst-1" })
      .mockResolvedValueOnce({
        id: "row-1",
        installation_id: "inst-1",
        access_token: "enc",
        refresh_token: null,
        expires_at: new Date(),
        scope: null,
        modified_time: new Date(),
        last_refresh_error: null,
        last_refresh_error_at: null,
      });

    await upsertFlairToken({
      installationId: "inst-1",
      accessToken: "at",
      refreshToken: null,
      expiresAt: new Date(),
      scope: null,
    });

    expect(update).toHaveBeenCalledWith(
      "row-1",
      expect.objectContaining({
        last_refresh_error: null,
        last_refresh_error_at: null,
      }),
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("round-trips the access/refresh token through encryption on read", async () => {
    let stored: Record<string, unknown> | undefined;
    insert.mockImplementationOnce(async (row: Record<string, unknown>) => {
      stored = row;
    });
    findOne
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => stored);

    // upsertFlairToken's own return value is fetched via a second findOne —
    // stub every subsequent call to return the just-inserted row.
    findOne.mockImplementation(async () => stored);

    const result = await upsertFlairToken({
      installationId: "inst-1",
      accessToken: "plaintext-access-token",
      refreshToken: "plaintext-refresh-token",
      expiresAt: new Date(),
      scope: null,
    });

    expect(result.accessToken).toBe("plaintext-access-token");
    expect(result.refreshToken).toBe("plaintext-refresh-token");
  });

  it("returns null when no token is stored for the installation", async () => {
    findOne.mockResolvedValueOnce(undefined);
    expect(await getFlairTokenByInstallation("inst-none")).toBeNull();
  });

  it("records a refresh error with a timestamp", async () => {
    await recordFlairRefreshError("inst-1", "boom");
    expect(update).toHaveBeenCalledWith(
      { installation_id: "inst-1" },
      expect.objectContaining({ last_refresh_error: "boom" }),
    );
  });

  describe("resolveFlairCredentials", () => {
    it("returns null when the installation has no BYO credentials set", async () => {
      findOne.mockResolvedValueOnce({ client_id: null, client_secret: null });
      expect(await resolveFlairCredentials("inst-1")).toBeNull();
    });

    it("returns null when there's no flair_tokens row at all", async () => {
      findOne.mockResolvedValueOnce(undefined);
      expect(await resolveFlairCredentials("inst-1")).toBeNull();
    });

    it("returns a set credential pair, decrypting the secret", async () => {
      findOne.mockResolvedValueOnce({
        client_id: "cid-1",
        // Not "enc:v1:"-prefixed, so decryptIfEncrypted passes it through
        // unchanged — the real encrypt/decrypt round trip is already
        // covered by tokenCrypto.test.ts and upsertFlairToken's own test
        // above; this test is about resolveFlairCredentials' own mapping.
        client_secret: "plain-secret",
      });
      const result = await resolveFlairCredentials("inst-1");
      expect(result).toEqual({
        clientId: "cid-1",
        clientSecret: "plain-secret",
      });
    });
  });

  describe("setFlairCredentials", () => {
    it("inserts a new row when none exists yet", async () => {
      findOne.mockResolvedValueOnce(undefined);
      await setFlairCredentials({
        installationId: "inst-1",
        clientId: "cid-1",
        clientSecret: "raw-secret",
      });
      expect(insert).toHaveBeenCalledOnce();
      const inserted = insert.mock.calls[0][0];
      expect(inserted.installation_id).toBe("inst-1");
      expect(inserted.client_id).toBe("cid-1");
      // Never stores the plaintext secret.
      expect(inserted.client_secret).not.toBe("raw-secret");
    });

    it("updates the existing row when one already exists", async () => {
      findOne.mockResolvedValueOnce({ id: "row-1" });
      await setFlairCredentials({
        installationId: "inst-1",
        clientId: "cid-2",
        clientSecret: "raw-secret-2",
      });
      expect(update).toHaveBeenCalledOnce();
      expect(insert).not.toHaveBeenCalled();
      const [id, fields] = update.mock.calls[0];
      expect(id).toBe("row-1");
      expect(fields.client_id).toBe("cid-2");
    });
  });
});
