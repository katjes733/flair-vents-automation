import { describe, it, expect, vi, beforeEach } from "vitest";

const { listAccessibleInstallations, countOwners } = vi.hoisted(() => ({
  listAccessibleInstallations: vi.fn(),
  countOwners: vi.fn(),
}));
vi.mock("~/server/util/routes/installationMember", () => ({
  listAccessibleInstallations,
  countOwners,
}));

const { invalidateAllSessionsForUser } = vi.hoisted(() => ({
  invalidateAllSessionsForUser: vi.fn(),
}));
vi.mock("~/server/util/sessionRegistry", () => ({
  invalidateAllSessionsForUser,
}));

const { deleteRepo, transaction } = vi.hoisted(() => ({
  deleteRepo: vi.fn(),
  transaction: vi.fn(),
}));
const { getInstance } = vi.hoisted(() => ({
  getInstance: vi.fn().mockResolvedValue({ transaction }),
}));
vi.mock("~/server/database/datasource", () => ({
  default: { getInstance },
}));

const { assertCanDeleteAccount, deleteUserAccount } =
  await import("~/server/util/services/accountService");

beforeEach(() => {
  listAccessibleInstallations.mockReset().mockResolvedValue([]);
  countOwners.mockReset();
  invalidateAllSessionsForUser.mockReset().mockResolvedValue(undefined);
  deleteRepo.mockReset().mockResolvedValue(undefined);
  transaction.mockReset().mockImplementation(async (fn: any) => {
    const manager = { getRepository: () => ({ delete: deleteRepo }) };
    return fn(manager);
  });
});

describe("assertCanDeleteAccount", () => {
  it("allows deletion when the user belongs to no installations", async () => {
    listAccessibleInstallations.mockResolvedValue([]);
    await expect(assertCanDeleteAccount("user-1")).resolves.toBeUndefined();
  });

  it("allows deletion when the user is a non-owner member", async () => {
    listAccessibleInstallations.mockResolvedValue([
      { installationId: "inst-1", installationName: "Home", role: "write" },
    ]);
    await expect(assertCanDeleteAccount("user-1")).resolves.toBeUndefined();
    expect(countOwners).not.toHaveBeenCalled();
  });

  it("allows deletion when the user is an owner but a co-owner also exists", async () => {
    listAccessibleInstallations.mockResolvedValue([
      { installationId: "inst-1", installationName: "Home", role: "owner" },
    ]);
    countOwners.mockResolvedValue(2);
    await expect(assertCanDeleteAccount("user-1")).resolves.toBeUndefined();
  });

  it("blocks deletion when the user is the sole owner of an installation", async () => {
    listAccessibleInstallations.mockResolvedValue([
      { installationId: "inst-1", installationName: "Home", role: "owner" },
    ]);
    countOwners.mockResolvedValue(1);
    await expect(assertCanDeleteAccount("user-1")).rejects.toThrow(
      /only owner of Home/,
    );
  });

  it("names every blocking installation when the user is the sole owner of more than one", async () => {
    listAccessibleInstallations.mockResolvedValue([
      { installationId: "inst-1", installationName: "Home", role: "owner" },
      { installationId: "inst-2", installationName: "Cabin", role: "owner" },
    ]);
    countOwners.mockResolvedValue(1);
    await expect(assertCanDeleteAccount("user-1")).rejects.toThrow(
      /Home, Cabin/,
    );
  });
});

describe("deleteUserAccount", () => {
  it("rejects before touching the database if the sole-owner check fails", async () => {
    listAccessibleInstallations.mockResolvedValue([
      { installationId: "inst-1", installationName: "Home", role: "owner" },
    ]);
    countOwners.mockResolvedValue(1);
    await expect(
      deleteUserAccount({ userId: "user-1", email: "a@example.com" }),
    ).rejects.toThrow(/only owner/);
    expect(transaction).not.toHaveBeenCalled();
    expect(invalidateAllSessionsForUser).not.toHaveBeenCalled();
  });

  it("deletes every membership row and the user row in one transaction, then invalidates every session", async () => {
    listAccessibleInstallations.mockResolvedValue([]);
    await deleteUserAccount({ userId: "user-1", email: "a@example.com" });
    expect(transaction).toHaveBeenCalledOnce();
    expect(deleteRepo).toHaveBeenCalledWith({ user_id: "user-1" });
    expect(deleteRepo).toHaveBeenCalledWith("user-1");
    expect(invalidateAllSessionsForUser).toHaveBeenCalledWith("a@example.com");
  });
});
