import { describe, it, expect, vi, beforeEach } from "vitest";

const { getPendingSignup, deletePendingSignup } = vi.hoisted(() => ({
  getPendingSignup: vi.fn(),
  deletePendingSignup: vi.fn(),
}));
vi.mock("~/server/util/pendingSignup", () => ({
  getPendingSignup,
  deletePendingSignup,
}));

const { validateFlairCredentials } = vi.hoisted(() => ({
  validateFlairCredentials: vi.fn(),
}));
vi.mock("~/server/util/flair/bootstrapValidate", () => ({
  validateFlairCredentials,
}));

const { establishSession } = vi.hoisted(() => ({ establishSession: vi.fn() }));
vi.mock("~/server/util/sessionEstablish", () => ({ establishSession }));

const { insertCalls, transaction } = vi.hoisted(() => {
  const insertCalls: Array<{ entity: string; row: Record<string, unknown> }> =
    [];
  const getRepository = (entity: string) => ({
    insert: vi.fn(async (row: Record<string, unknown>) => {
      insertCalls.push({ entity, row });
    }),
  });
  const transaction = vi.fn(async (fn: (manager: unknown) => Promise<void>) => {
    await fn({ getRepository });
  });
  return { insertCalls, getRepository, transaction };
});
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance: vi.fn().mockResolvedValue({ transaction }) },
}));

process.env.TOKEN_ENCRYPTION_KEY = "0".repeat(64);

const { completeByoFlairSignup } =
  await import("~/server/util/services/signupService");

const VALIDATED = {
  accessToken: "at-1",
  expiresAt: new Date(Date.now() + 3600 * 1000),
  scope: "vents.edit",
  structure: { id: "struct-1", name: "Upstairs", timeZone: null },
};

beforeEach(() => {
  getPendingSignup.mockReset();
  deletePendingSignup.mockReset().mockResolvedValue(undefined);
  validateFlairCredentials.mockReset();
  transaction.mockClear();
  insertCalls.length = 0;
  establishSession.mockReset().mockResolvedValue({
    message: "Logged in",
    user: { loginEmail: "a@example.com" },
    sessionExpiry: 12345,
  });
});

describe("completeByoFlairSignup", () => {
  it("throws (404) when there's no pending signup for the email", async () => {
    getPendingSignup.mockResolvedValue(null);
    await expect(
      completeByoFlairSignup({
        req: {} as any,
        email: "nobody@example.com",
        flairClientId: "cid",
        flairClientSecret: "csecret",
      }),
    ).rejects.toThrow(/No pending signup/);
    expect(validateFlairCredentials).not.toHaveBeenCalled();
  });

  it("validates credentials before writing anything", async () => {
    getPendingSignup.mockResolvedValue({ passwordHash: "hash" });
    validateFlairCredentials.mockRejectedValue(new Error("invalid"));
    await expect(
      completeByoFlairSignup({
        req: {} as any,
        email: "a@example.com",
        flairClientId: "bad-cid",
        flairClientSecret: "bad-secret",
      }),
    ).rejects.toThrow(/invalid/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not delete the pending signup if the transaction itself fails", async () => {
    getPendingSignup.mockResolvedValue({ passwordHash: "hash" });
    validateFlairCredentials.mockResolvedValue(VALIDATED);
    transaction.mockRejectedValueOnce(new Error("db down"));
    await expect(
      completeByoFlairSignup({
        req: {} as any,
        email: "a@example.com",
        flairClientId: "cid",
        flairClientSecret: "csecret",
      }),
    ).rejects.toThrow(/db down/);
    expect(deletePendingSignup).not.toHaveBeenCalled();
  });

  it("creates the installation, user, owner membership, and flair token inside one transaction on success", async () => {
    getPendingSignup.mockResolvedValue({
      passwordHash: "hashed-pw",
      userDetails: { displayName: "A" },
    });
    validateFlairCredentials.mockResolvedValue(VALIDATED);

    const result = await completeByoFlairSignup({
      req: { session: {} } as any,
      email: "a@example.com",
      flairClientId: "cid-1",
      flairClientSecret: "raw-secret",
    });

    expect(transaction).toHaveBeenCalledOnce();
    const entities = insertCalls.map((c) => c.entity);
    expect(entities).toEqual([
      "Installation",
      "User",
      "InstallationMember",
      "FlairToken",
    ]);

    const installationRow = insertCalls.find(
      (c) => c.entity === "Installation",
    )!.row;
    expect(installationRow.flair_structure_id).toBe("struct-1");
    expect(installationRow.name).toContain("a@example.com");

    const userRow = insertCalls.find((c) => c.entity === "User")!.row;
    expect(userRow.email).toBe("a@example.com");
    expect(userRow.password_hash).toBe("hashed-pw");
    expect(userRow.user_details).toEqual({ displayName: "A" });

    const memberRow = insertCalls.find(
      (c) => c.entity === "InstallationMember",
    )!.row;
    expect(memberRow.installation_id).toBe(installationRow.id);
    expect(memberRow.user_id).toBe(userRow.id);
    expect(memberRow.role).toBe("owner");
    expect(memberRow.scope).toEqual({ air_handler_ids: "*" });

    const tokenRow = insertCalls.find((c) => c.entity === "FlairToken")!.row;
    expect(tokenRow.installation_id).toBe(installationRow.id);
    expect(tokenRow.client_id).toBe("cid-1");
    // Never stores plaintext secrets.
    expect(tokenRow.client_secret).not.toBe("raw-secret");
    expect(tokenRow.access_token).not.toBe("at-1");

    expect(deletePendingSignup).toHaveBeenCalledWith("a@example.com");
    expect(establishSession).toHaveBeenCalledWith(
      expect.anything(),
      "a@example.com",
    );
    expect(result).toEqual({
      message: "Logged in",
      user: { loginEmail: "a@example.com" },
      sessionExpiry: 12345,
    });
  });
});
