import { HttpError } from "~/server/util/httpError";
import { getUserByEmail, createUser } from "~/server/util/routes/user";
import {
  createInstallationMember,
  countOwners,
  listMembersForInstallation,
  getInstallationMemberById,
  updateInstallationMember,
  deleteInstallationMember,
  type InstallationMemberRow,
} from "~/server/util/routes/installationMember";
import type {
  InstallationMemberRole,
  IInstallationMemberScope,
} from "~/server/database/models/installationMember";
import { generateAndSendCode } from "~/server/routes/signupVerification";
import { escapeHtml } from "~/server/util/mailing";

// Invite emails get a much longer TTL than self-signup's 15 minutes — an
// invitee has to notice the email first, possibly much later, per the
// plan's own "a self-signup user is already on the signup page waiting
// for this code" reasoning for why the two cases warrant different TTLs.
const INVITE_CODE_TTL_MINUTES = 24 * 60;

// "owner" is a real, stored role — not derived — precisely so it can be
// revoked/downgraded like any other, per this app's own deliberate
// departure from tesla-powerwall-automation's RefreshToken-existence
// trick. But granting or revoking it is a role-comparison rule, not an
// ActionSchema leaf: "admin" and "owner" already share the same profile
// (ADMIN_PROFILE) for every ordinary action, so nothing in requirePermission
// alone can tell them apart — this is the one place that distinction is
// checked explicitly.
function assertActorCanGrantRole(
  actorRole: InstallationMemberRole,
  targetRole: InstallationMemberRole,
): void {
  if (targetRole === "owner" && actorRole !== "owner") {
    throw new HttpError("Only an owner can grant the owner role.", 403);
  }
}

// The installation's own last-owner invariant — checked before any role
// change or revoke that could violate it, not expressible as a DB
// constraint since it depends on every OTHER row's role, not just this one.
async function assertWouldNotRemoveLastOwner(
  installationId: string,
  memberRole: InstallationMemberRole,
): Promise<void> {
  if (memberRole !== "owner") return;
  const owners = await countOwners(installationId);
  if (owners <= 1) {
    throw new HttpError(
      "This installation must have at least one owner — promote another member to owner first.",
      400,
    );
  }
}

export async function inviteMemberToInstallation(opts: {
  installationId: string;
  installationName: string;
  actorRole: InstallationMemberRole;
  email: string;
  role: InstallationMemberRole;
  scope?: IInstallationMemberScope;
  origin: string;
}): Promise<InstallationMemberRow> {
  assertActorCanGrantRole(opts.actorRole, opts.role);

  const existingMembers = await listMembersForInstallation(opts.installationId);
  if (
    existingMembers.some(
      (m) => m.email.toLowerCase() === opts.email.toLowerCase(),
    )
  ) {
    throw new HttpError(
      `${opts.email} is already a member of this installation.`,
      400,
    );
  }

  // password_hash: "" is the established "invited, not yet activated"
  // sentinel (matches the pattern this app's own signup flow already
  // documents for a future invite flow) — a real login can never succeed
  // against it, since argon2.verify always fails a non-matching input
  // against it; the user only becomes usable once /auth/activate-invite
  // sets a real hash. If a real, already-activated account exists for this
  // email (e.g. they already own a different installation), it's simply
  // reused — the same person can belong to more than one installation.
  let user = await getUserByEmail(opts.email);
  if (!user) {
    user = await createUser({ email: opts.email, passwordHash: "" });
  }

  const created = await createInstallationMember({
    installationId: opts.installationId,
    userId: user.id,
    role: opts.role,
    scope: opts.scope,
  });

  const acceptUrl = `${opts.origin}/accept-invite?email=${encodeURIComponent(opts.email)}`;
  await generateAndSendCode(
    opts.email,
    (code) => ({
      subject: `You've been invited to ${opts.installationName} on Flair Vents Automation`,
      text: `You've been invited to join "${opts.installationName}" on Flair Vents Automation as a${opts.role === "admin" ? "n" : ""} ${opts.role}.\n\nYour verification code is: ${code}\n\nThis code is valid for 24 hours.\n\nAccept your invite: ${acceptUrl}`,
      html: `<p>You've been invited to join <strong>${escapeHtml(opts.installationName)}</strong> on Flair Vents Automation as a${opts.role === "admin" ? "n" : ""} <strong>${escapeHtml(opts.role)}</strong>.</p>
<p>Your verification code is: <strong>${code}</strong></p>
<p>This code is valid for 24 hours.</p>
<p><a href="${escapeHtml(acceptUrl)}">Accept your invite</a></p>`,
    }),
    INVITE_CODE_TTL_MINUTES,
  );

  return {
    id: created.id,
    installationId: opts.installationId,
    userId: user.id,
    email: opts.email,
    role: opts.role,
    scope: opts.scope ?? { air_handler_ids: "*" },
    createdAt: created.createdAt,
  };
}

// 404 (not 403) on a cross-installation id, matching this app's own
// established convention for every other resource — a member id from a
// different installation reads identically to an unknown one.
async function getOwnMember(
  installationId: string,
  memberId: string,
): Promise<InstallationMemberRow> {
  const member = await getInstallationMemberById(memberId);
  if (!member || member.installationId !== installationId) {
    throw new HttpError(`Member ${memberId} not found.`, 404);
  }
  return member;
}

export async function updateInstallationMemberRole(opts: {
  installationId: string;
  actorRole: InstallationMemberRole;
  memberId: string;
  role?: InstallationMemberRole;
  scope?: IInstallationMemberScope;
}): Promise<void> {
  const member = await getOwnMember(opts.installationId, opts.memberId);

  if (opts.role) {
    assertActorCanGrantRole(opts.actorRole, opts.role);
    if (opts.role !== "owner") {
      await assertWouldNotRemoveLastOwner(opts.installationId, member.role);
    }
  }

  await updateInstallationMember(opts.memberId, {
    role: opts.role,
    scope: opts.scope,
  });
}

export async function revokeInstallationMember(opts: {
  installationId: string;
  memberId: string;
}): Promise<void> {
  const member = await getOwnMember(opts.installationId, opts.memberId);
  await assertWouldNotRemoveLastOwner(opts.installationId, member.role);
  await deleteInstallationMember(opts.memberId);
}
