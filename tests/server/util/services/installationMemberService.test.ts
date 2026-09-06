import { describe, it, expect, vi, beforeEach } from "vitest";

const { getUserByEmail, createUser } = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
}));
vi.mock("~/server/util/routes/user", () => ({ getUserByEmail, createUser }));

const {
  createInstallationMember,
  countOwners,
  listMembersForInstallation,
  getInstallationMemberById,
  updateInstallationMember,
  deleteInstallationMember,
} = vi.hoisted(() => ({
  createInstallationMember: vi.fn(),
  countOwners: vi.fn(),
  listMembersForInstallation: vi.fn(),
  getInstallationMemberById: vi.fn(),
  updateInstallationMember: vi.fn(),
  deleteInstallationMember: vi.fn(),
}));
vi.mock("~/server/util/routes/installationMember", () => ({
  createInstallationMember,
  countOwners,
  listMembersForInstallation,
  getInstallationMemberById,
  updateInstallationMember,
  deleteInstallationMember,
}));

const { generateAndSendCode } = vi.hoisted(() => ({
  generateAndSendCode: vi.fn(),
}));
vi.mock("~/server/routes/signupVerification", () => ({ generateAndSendCode }));

const {
  inviteMemberToInstallation,
  resendInviteToMember,
  updateInstallationMemberRole,
  revokeInstallationMember,
} = await import("~/server/util/services/installationMemberService");

beforeEach(() => {
  getUserByEmail.mockReset();
  createUser.mockReset();
  createInstallationMember.mockReset();
  countOwners.mockReset();
  listMembersForInstallation.mockReset().mockResolvedValue([]);
  getInstallationMemberById.mockReset();
  updateInstallationMember.mockReset().mockResolvedValue(undefined);
  deleteInstallationMember.mockReset().mockResolvedValue(undefined);
  generateAndSendCode.mockReset().mockResolvedValue(undefined);
});

const baseInviteOpts = {
  installationId: "inst-1",
  installationName: "Martin's Home",
  actorRole: "owner" as const,
  email: "new@example.com",
  role: "write" as const,
  origin: "http://localhost:5173",
};

describe("inviteMemberToInstallation", () => {
  it("rejects granting the owner role from a non-owner actor", async () => {
    await expect(
      inviteMemberToInstallation({
        ...baseInviteOpts,
        actorRole: "admin",
        role: "owner",
      }),
    ).rejects.toThrow(/Only an owner can grant the owner role/);
    expect(createInstallationMember).not.toHaveBeenCalled();
  });

  it("allows an owner to grant the owner role", async () => {
    getUserByEmail.mockResolvedValue(null);
    createUser.mockResolvedValue({ id: "user-2" });
    createInstallationMember.mockResolvedValue({
      id: "member-1",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    await inviteMemberToInstallation({
      ...baseInviteOpts,
      actorRole: "owner",
      role: "owner",
    });
    expect(createInstallationMember).toHaveBeenCalledWith(
      expect.objectContaining({ role: "owner" }),
    );
  });

  it("rejects inviting an email that's already a member of this installation", async () => {
    listMembersForInstallation.mockResolvedValue([
      { email: "New@Example.com" },
    ]);
    await expect(inviteMemberToInstallation(baseInviteOpts)).rejects.toThrow(
      /already a member/,
    );
    expect(createInstallationMember).not.toHaveBeenCalled();
  });

  it("creates a new placeholder user (empty password hash) when none exists yet", async () => {
    getUserByEmail.mockResolvedValue(null);
    createUser.mockResolvedValue({ id: "user-2" });
    createInstallationMember.mockResolvedValue({
      id: "member-1",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    await inviteMemberToInstallation(baseInviteOpts);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@example.com", passwordHash: "" }),
    );
    expect(createInstallationMember).toHaveBeenCalledWith({
      installationId: "inst-1",
      userId: "user-2",
      role: "write",
      scope: undefined,
    });
  });

  it("reuses an existing real user (already a member of a different installation) rather than creating a duplicate", async () => {
    getUserByEmail.mockResolvedValue({ id: "user-9", passwordHash: "hash" });
    createInstallationMember.mockResolvedValue({
      id: "member-1",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    const result = await inviteMemberToInstallation(baseInviteOpts);
    expect(createUser).not.toHaveBeenCalled();
    expect(createInstallationMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-9" }),
    );
    // Reusing an already-activated account means this brand-new membership
    // isn't "pending" the way a genuinely fresh invite is — pending reflects
    // the user's own real state, not just "was this row just created."
    expect(result.pending).toBe(false);
  });

  it("sends an invite email with a link to /accept-invite and a 24h TTL", async () => {
    getUserByEmail.mockResolvedValue(null);
    createUser.mockResolvedValue({ id: "user-2" });
    createInstallationMember.mockResolvedValue({
      id: "member-1",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    await inviteMemberToInstallation(baseInviteOpts);
    expect(generateAndSendCode).toHaveBeenCalledWith(
      "new@example.com",
      expect.any(Function),
      24 * 60,
    );
    const buildEmail = generateAndSendCode.mock.calls[0][1];
    const email = buildEmail("123456");
    expect(email.text).toContain("/accept-invite?email=new%40example.com");
    expect(email.text).toContain("123456");
  });

  it("returns the created member's full row", async () => {
    getUserByEmail.mockResolvedValue(null);
    createUser.mockResolvedValue({ id: "user-2", passwordHash: "" });
    createInstallationMember.mockResolvedValue({
      id: "member-1",
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    const result = await inviteMemberToInstallation(baseInviteOpts);
    expect(result).toEqual({
      id: "member-1",
      installationId: "inst-1",
      userId: "user-2",
      email: "new@example.com",
      pending: true,
      role: "write",
      scope: { air_handler_ids: "*" },
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
  });
});

describe("resendInviteToMember", () => {
  const baseResendOpts = {
    installationId: "inst-1",
    installationName: "Martin's Home",
    memberId: "member-1",
    origin: "http://localhost:5173",
  };

  it("404s (not 403) when the member belongs to a different installation", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-other",
      email: "invited@example.com",
      role: "write",
      pending: true,
    });
    await expect(resendInviteToMember(baseResendOpts)).rejects.toThrow(
      /not found/,
    );
    expect(generateAndSendCode).not.toHaveBeenCalled();
  });

  it("rejects an already-activated member — there's no pending invite left", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      email: "active@example.com",
      role: "write",
      pending: false,
    });
    await expect(resendInviteToMember(baseResendOpts)).rejects.toThrow(
      /already accepted/,
    );
    expect(generateAndSendCode).not.toHaveBeenCalled();
  });

  it("resends the invite code to a still-pending member", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      email: "invited@example.com",
      role: "write",
      pending: true,
    });
    await resendInviteToMember(baseResendOpts);
    expect(generateAndSendCode).toHaveBeenCalledWith(
      "invited@example.com",
      expect.any(Function),
      24 * 60,
    );
    const buildEmail = generateAndSendCode.mock.calls[0][1];
    const email = buildEmail("654321");
    expect(email.text).toContain("/accept-invite?email=invited%40example.com");
    expect(email.text).toContain("654321");
  });
});

describe("updateInstallationMemberRole", () => {
  it("404s (not 403) when the member belongs to a different installation", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-other",
      role: "write",
    });
    await expect(
      updateInstallationMemberRole({
        installationId: "inst-1",
        actorRole: "owner",
        memberId: "member-1",
        role: "read",
      }),
    ).rejects.toThrow(/not found/);
    expect(updateInstallationMember).not.toHaveBeenCalled();
  });

  it("404s when the member doesn't exist", async () => {
    getInstallationMemberById.mockResolvedValue(null);
    await expect(
      updateInstallationMemberRole({
        installationId: "inst-1",
        actorRole: "owner",
        memberId: "missing",
        role: "read",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("rejects a non-owner actor promoting someone to owner", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      role: "write",
    });
    await expect(
      updateInstallationMemberRole({
        installationId: "inst-1",
        actorRole: "admin",
        memberId: "member-1",
        role: "owner",
      }),
    ).rejects.toThrow(/Only an owner can grant/);
    expect(updateInstallationMember).not.toHaveBeenCalled();
  });

  it("rejects demoting the installation's last owner", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      role: "owner",
    });
    countOwners.mockResolvedValue(1);
    await expect(
      updateInstallationMemberRole({
        installationId: "inst-1",
        actorRole: "owner",
        memberId: "member-1",
        role: "admin",
      }),
    ).rejects.toThrow(/at least one owner/);
    expect(updateInstallationMember).not.toHaveBeenCalled();
  });

  it("allows demoting an owner when another owner still remains", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      role: "owner",
    });
    countOwners.mockResolvedValue(2);
    await updateInstallationMemberRole({
      installationId: "inst-1",
      actorRole: "owner",
      memberId: "member-1",
      role: "admin",
    });
    expect(updateInstallationMember).toHaveBeenCalledWith("member-1", {
      role: "admin",
      scope: undefined,
    });
  });

  it("allows a no-op re-save of the sole owner's own role", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      role: "owner",
    });
    await updateInstallationMemberRole({
      installationId: "inst-1",
      actorRole: "owner",
      memberId: "member-1",
      role: "owner",
    });
    expect(countOwners).not.toHaveBeenCalled();
    expect(updateInstallationMember).toHaveBeenCalledWith("member-1", {
      role: "owner",
      scope: undefined,
    });
  });

  it("allows a scope-only update with no role change and no owner check at all", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      role: "write",
    });
    await updateInstallationMemberRole({
      installationId: "inst-1",
      actorRole: "owner",
      memberId: "member-1",
      scope: { air_handler_ids: ["ah-1"] },
    });
    expect(countOwners).not.toHaveBeenCalled();
    expect(updateInstallationMember).toHaveBeenCalledWith("member-1", {
      role: undefined,
      scope: { air_handler_ids: ["ah-1"] },
    });
  });
});

describe("revokeInstallationMember", () => {
  it("404s (not 403) when the member belongs to a different installation", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-other",
      role: "write",
    });
    await expect(
      revokeInstallationMember({
        installationId: "inst-1",
        memberId: "member-1",
      }),
    ).rejects.toThrow(/not found/);
    expect(deleteInstallationMember).not.toHaveBeenCalled();
  });

  it("rejects revoking the installation's last owner", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      role: "owner",
    });
    countOwners.mockResolvedValue(1);
    await expect(
      revokeInstallationMember({
        installationId: "inst-1",
        memberId: "member-1",
      }),
    ).rejects.toThrow(/at least one owner/);
    expect(deleteInstallationMember).not.toHaveBeenCalled();
  });

  it("revokes a non-owner member cleanly", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      role: "write",
    });
    await revokeInstallationMember({
      installationId: "inst-1",
      memberId: "member-1",
    });
    expect(deleteInstallationMember).toHaveBeenCalledWith("member-1");
  });

  it("revokes an owner when another owner still remains", async () => {
    getInstallationMemberById.mockResolvedValue({
      id: "member-1",
      installationId: "inst-1",
      role: "owner",
    });
    countOwners.mockResolvedValue(2);
    await revokeInstallationMember({
      installationId: "inst-1",
      memberId: "member-1",
    });
    expect(deleteInstallationMember).toHaveBeenCalledWith("member-1");
  });
});
