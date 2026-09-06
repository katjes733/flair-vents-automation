import { describe, it, expect, vi, beforeEach } from "vitest";

const { listAccessibleInstallations } = vi.hoisted(() => ({
  listAccessibleInstallations: vi.fn(),
}));
vi.mock("~/server/util/routes/installationMember", () => ({
  listAccessibleInstallations,
}));

const { getUserByEmail } = vi.hoisted(() => ({ getUserByEmail: vi.fn() }));
vi.mock("~/server/util/routes/user", () => ({ getUserByEmail }));

const {
  selectActiveInstallation,
  resolveActor,
  listAccessibleInstallationChoices,
} = await import("~/server/util/resolveActor");

const OWNER_CHOICE = {
  installationId: "inst-owner",
  installationName: "Owner's Home",
  role: "owner" as const,
  scope: { air_handler_ids: "*" as const },
  source: "member" as const,
};
const READ_CHOICE = {
  installationId: "inst-read",
  installationName: "Shared Home",
  role: "read" as const,
  scope: { air_handler_ids: ["ah-1"] },
  source: "member" as const,
};

beforeEach(() => {
  listAccessibleInstallations.mockReset();
  getUserByEmail.mockReset();
});

describe("selectActiveInstallation", () => {
  it("errors with no_access when there are zero choices", () => {
    expect(selectActiveInstallation([])).toEqual({ error: "no_access" });
  });

  it("returns the single choice when there's exactly one", () => {
    expect(selectActiveInstallation([READ_CHOICE])).toEqual(READ_CHOICE);
  });

  it("prefers the owner row when there's no requested id and multiple choices exist", () => {
    expect(selectActiveInstallation([READ_CHOICE, OWNER_CHOICE])).toEqual(
      OWNER_CHOICE,
    );
  });

  it("errors ambiguous when there are multiple choices, none owned, no request", () => {
    const secondNonOwner = { ...READ_CHOICE, installationId: "inst-2" };
    expect(selectActiveInstallation([READ_CHOICE, secondNonOwner])).toEqual({
      error: "ambiguous",
    });
  });

  it("returns the exact match when a specific installation is requested", () => {
    expect(
      selectActiveInstallation([READ_CHOICE, OWNER_CHOICE], "inst-read"),
    ).toEqual(READ_CHOICE);
  });

  it("errors not_authorized_for_installation when the requested id isn't accessible", () => {
    expect(selectActiveInstallation([READ_CHOICE], "inst-nonexistent")).toEqual(
      { error: "not_authorized_for_installation" },
    );
  });
});

describe("listAccessibleInstallationChoices", () => {
  it("maps every row to a 'member'-sourced choice", async () => {
    listAccessibleInstallations.mockResolvedValue([
      {
        installationId: "inst-1",
        installationName: "Home",
        role: "owner",
        scope: { air_handler_ids: "*" },
      },
    ]);
    const result = await listAccessibleInstallationChoices("user-1");
    expect(result).toEqual([
      {
        installationId: "inst-1",
        installationName: "Home",
        role: "owner",
        scope: { air_handler_ids: "*" },
        source: "member",
      },
    ]);
  });
});

describe("resolveActor", () => {
  it("errors no_access when the login email has no matching user row", async () => {
    getUserByEmail.mockResolvedValue(null);
    const result = await resolveActor("nobody@example.com");
    expect(result).toEqual({ error: "no_access" });
    expect(listAccessibleInstallations).not.toHaveBeenCalled();
  });

  it("resolves owner/admin roles to the admin profile", async () => {
    getUserByEmail.mockResolvedValue({ id: "user-1" });
    listAccessibleInstallations.mockResolvedValue([
      {
        installationId: "inst-1",
        installationName: "Home",
        role: "owner",
        scope: { air_handler_ids: "*" },
      },
    ]);
    const result = await resolveActor("a@example.com");
    expect(result).toMatchObject({
      loginEmail: "a@example.com",
      installationId: "inst-1",
      role: "owner",
      profile: "admin",
    });
  });

  it("resolves a write role to the write profile, read to the read profile", async () => {
    getUserByEmail.mockResolvedValue({ id: "user-1" });
    listAccessibleInstallations.mockResolvedValue([
      {
        installationId: "inst-1",
        installationName: "Home",
        role: "write",
        scope: { air_handler_ids: "*" },
      },
    ]);
    expect((await resolveActor("a@example.com")) as any).toMatchObject({
      profile: "write",
    });

    listAccessibleInstallations.mockResolvedValue([
      {
        installationId: "inst-1",
        installationName: "Home",
        role: "read",
        scope: { air_handler_ids: "*" },
      },
    ]);
    expect((await resolveActor("a@example.com")) as any).toMatchObject({
      profile: "read",
    });
  });

  it("propagates the x-installation-id-driven selection error", async () => {
    getUserByEmail.mockResolvedValue({ id: "user-1" });
    listAccessibleInstallations.mockResolvedValue([
      {
        installationId: "inst-1",
        installationName: "Home",
        role: "read",
        scope: { air_handler_ids: "*" },
      },
    ]);
    const result = await resolveActor("a@example.com", "inst-other");
    expect(result).toEqual({ error: "not_authorized_for_installation" });
  });
});
