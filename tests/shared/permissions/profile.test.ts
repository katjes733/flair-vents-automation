import { describe, it, expect } from "vitest";
import {
  resolveAccessLevel,
  getElementState,
  READ_PROFILE,
  WRITE_PROFILE,
  ADMIN_PROFILE,
} from "~/shared/permissions/profile";
import type { ActionSchema } from "~/shared/permissions/schema";

describe("resolveAccessLevel", () => {
  it("resolves an unset leaf to none", () => {
    expect(resolveAccessLevel({}, "dashboard.zone.create")).toBe("none");
  });

  it("resolves a leaf set directly", () => {
    const profile: ActionSchema = { dashboard: { zone: { create: "read" } } };
    expect(resolveAccessLevel(profile, "dashboard.zone.create")).toBe("read");
  });

  it("caps a nested leaf at an ancestor's own access level, regardless of the leaf's own value", () => {
    const profile: ActionSchema = {
      dashboard: { access: "read", zone: { create: "write" } },
    };
    // The leaf itself says "write", but dashboard.access caps every leaf
    // beneath it at "read" — this is the specific behavior a naive
    // per-leaf lookup (copying spike-detection's own bucket-scoping
    // mistake pattern from elsewhere in this project) would get wrong.
    expect(resolveAccessLevel(profile, "dashboard.zone.create")).toBe("read");
  });

  it("an access sibling never caps itself, only its own descendants", () => {
    const profile: ActionSchema = { dashboard: { access: "write" } };
    expect(resolveAccessLevel(profile, "dashboard.access")).toBe("write");
  });

  it("a none-capped ancestor floors every descendant leaf to none, even one set to write", () => {
    const profile: ActionSchema = {
      installationAdmin: { access: "none", inviteMember: "write" },
    };
    expect(resolveAccessLevel(profile, "installationAdmin.inviteMember")).toBe(
      "none",
    );
  });

  it("multiple ancestor caps compose to the tightest one", () => {
    const profile: ActionSchema = {
      dashboard: {
        access: "write",
        zone: { access: "read", override: { create: "write" } },
      },
    };
    expect(resolveAccessLevel(profile, "dashboard.zone.override.create")).toBe(
      "read",
    );
  });
});

describe("getElementState", () => {
  it("READ_PROFILE marks destructive actions read (visible, disabled), never write", () => {
    expect(getElementState("read", "dashboard.airHandler.delete")).toBe("read");
    expect(getElementState("read", "dashboard.zone.delete")).toBe("read");
  });

  it("READ_PROFILE has no access at all to installationAdmin", () => {
    expect(getElementState("read", "installationAdmin.inviteMember")).toBe(
      "none",
    );
  });

  it("WRITE_PROFILE grants full write to ordinary dashboard/schedule actions", () => {
    expect(getElementState("write", "dashboard.zone.create")).toBe("write");
    expect(getElementState("write", "schedules.dialog.eventEditor.save")).toBe(
      "write",
    );
  });

  it("WRITE_PROFILE still has no access to installationAdmin — admin-only", () => {
    expect(getElementState("write", "installationAdmin.inviteMember")).toBe(
      "none",
    );
  });

  it("ADMIN_PROFILE is WRITE_PROFILE plus installationAdmin", () => {
    expect(getElementState("admin", "dashboard.zone.create")).toBe("write");
    expect(getElementState("admin", "installationAdmin.inviteMember")).toBe(
      "write",
    );
  });

  it("every profile grants full access to managing one's own passkeys", () => {
    expect(getElementState("read", "account.access")).toBe("write");
    expect(getElementState("write", "account.access")).toBe("write");
    expect(getElementState("admin", "account.access")).toBe("write");
  });

  it("READ_PROFILE, WRITE_PROFILE, and ADMIN_PROFILE constants are wired to the right names", () => {
    expect(READ_PROFILE.dashboard?.access).toBe("write");
    expect(WRITE_PROFILE.dashboard?.zone?.create).toBe("write");
    expect(ADMIN_PROFILE.installationAdmin?.access).toBe("write");
  });
});
