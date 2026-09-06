import type { AccessLevel, ActionKey, ActionSchema } from "./schema";

export const PROFILE_NAMES = ["read", "write", "admin"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2 };
const min = (a: AccessLevel, b: AccessLevel): AccessLevel =>
  LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;

// A profile is simply a concrete, sparse value of type ActionSchema — no
// separate "Profile" type needed. Every field is optional, so a profile
// only states what it grants; anything omitted defaults to "none" (hidden)
// at lookup time. Mechanism ported verbatim from
// tesla-powerwall-automation's own shared/permissions/profile.ts; only the
// content below is this app's own.

export const READ_PROFILE: ActionSchema = {
  dashboard: {
    access: "write", // browsing the dashboard is always fully enabled for read-and-above
    airHandler: {
      access: "write",
      create: "read",
      edit: "read",
      delete: "read", // visible, disabled — not hidden
      syncZones: "read",
    },
    zone: {
      access: "write",
      create: "read",
      edit: "read",
      delete: "read",
      override: { access: "write", create: "read", revoke: "read" },
    },
    controlDisarm: { access: "write", disarm: "read", rearm: "read" },
    triggerTick: "read",
  },
  schedules: {
    access: "write",
    create: "read",
    edit: "read",
    delete: "read",
    dialog: {
      eventEditor: { access: "write", save: "read" },
      zonePriorityList: "read",
    },
  },
  diagnostics: { access: "write" },
  telemetry: { access: "write" },
  settings: { access: "write", write: "read" },
  systemParameters: { access: "write", write: "read" },
  flairConnection: { access: "write", reauthorize: "read" },
  account: { access: "write" },
  // installationAdmin: omitted entirely — every leaf resolves to "none" (hidden)
};

// Every leaf READ_PROFILE marks "read" (visible-disabled) becomes "write"
// (visible-enabled) here. Authored independently, not derived from
// READ_PROFILE at runtime — the duplication below is a one-time authoring
// cost, not a semantic dependency a future custom profile would need to
// replicate.
export const WRITE_PROFILE: ActionSchema = {
  dashboard: {
    access: "write",
    airHandler: {
      access: "write",
      create: "write",
      edit: "write",
      delete: "write",
      syncZones: "write",
    },
    zone: {
      access: "write",
      create: "write",
      edit: "write",
      delete: "write",
      override: { access: "write", create: "write", revoke: "write" },
    },
    controlDisarm: { access: "write", disarm: "write", rearm: "write" },
    triggerTick: "write",
  },
  schedules: {
    access: "write",
    create: "write",
    edit: "write",
    delete: "write",
    dialog: {
      eventEditor: { access: "write", save: "write" },
      zonePriorityList: "write",
    },
  },
  diagnostics: { access: "write" },
  telemetry: { access: "write" },
  settings: { access: "write", write: "write" },
  systemParameters: { access: "write", write: "write" },
  flairConnection: { access: "write", reauthorize: "write" },
  account: { access: "write" },
  // installationAdmin: still omitted — still "none" for Write
};

// Admin = Write plus the one admin-only domain. Composing via spread is
// fine here since it's authoring convenience, not a semantic dependency a
// future custom profile would need to replicate.
export const ADMIN_PROFILE: ActionSchema = {
  ...WRITE_PROFILE,
  installationAdmin: {
    access: "write",
    inviteMember: "write",
    updateMember: "write",
    revokeMember: "write",
  },
};

export const PROFILES: Record<ProfileName, ActionSchema> = {
  read: READ_PROFILE,
  write: WRITE_PROFILE,
  admin: ADMIN_PROFILE,
};

// Path walk over any concrete ActionSchema value, with one mechanical rule
// beyond a plain path-walk: "access" means the same thing at every depth —
// "can this be reached/viewed at all" — so wherever a container along the
// path defines its own "access" sibling (dashboard.access,
// dashboard.zone.access, etc.), that value is a hard CAP on every leaf
// nested anywhere beneath it, transitively, regardless of what those
// leaves are individually authored to. Exported (not just getElementState)
// so the capping algorithm itself can be unit-tested against synthetic
// profiles, independent of the app's real ones.
export function resolveAccessLevel(
  profile: ActionSchema,
  action: ActionKey,
): AccessLevel {
  const segments = action.split(".");
  let node: unknown = profile;
  let cap: AccessLevel = "write"; // uncapped until an ancestor's own "access" says otherwise
  for (let i = 0; i < segments.length; i++) {
    if (node == null || typeof node !== "object") return "none";
    const container = node as Record<string, unknown>;
    if (segments[i] !== "access" && typeof container.access === "string") {
      cap = min(cap, container.access as AccessLevel);
    }
    node = container[segments[i]];
  }
  const own = typeof node === "string" ? (node as AccessLevel) : "none";
  return min(own, cap);
}

// Path lookup into whichever named profile — the function every call site
// (server middleware, client hooks) actually uses.
export function getElementState(
  profileName: ProfileName,
  action: ActionKey,
): AccessLevel {
  return resolveAccessLevel(PROFILES[profileName], action);
}
