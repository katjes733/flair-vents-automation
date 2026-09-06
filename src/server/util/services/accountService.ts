import AppDataSource from "~/server/database/datasource";
import { HttpError } from "~/server/util/httpError";
import {
  listAccessibleInstallations,
  countOwners,
} from "~/server/util/routes/installationMember";
import { invalidateAllSessionsForUser } from "~/server/util/sessionRegistry";

// The one real product decision this flow has to make: what happens when
// the deleting user is the sole owner of an installation this app is
// actively controlling real HVAC hardware for. Cascading the delete down
// into that installation (and every zone/schedule/hardware config under
// it) would be a wildly disproportionate side effect of "delete my own
// account," and silently auto-promoting some other member to owner without
// their consent is its own kind of surprising. Blocking outright — the
// same "must have at least one owner" invariant already enforced on every
// role change/revoke (see installationMemberService.ts) — is the safe
// default: the user keeps their account until they've deliberately handed
// ownership to someone else, or deleted the installation themselves.
export async function assertCanDeleteAccount(userId: string): Promise<void> {
  const memberships = await listAccessibleInstallations(userId);
  const blockingNames: string[] = [];
  for (const membership of memberships) {
    if (membership.role !== "owner") continue;
    const owners = await countOwners(membership.installationId);
    if (owners <= 1) blockingNames.push(membership.installationName);
  }
  if (blockingNames.length > 0) {
    throw new HttpError(
      `You're the only owner of ${blockingNames.join(", ")} — promote another member to owner (or delete the installation) before deleting your account.`,
      400,
    );
  }
}

// Deletes the account itself — every installation_members row this user
// holds (regardless of role, across every installation), then the users
// row, in one transaction (mirrors signupService.ts's completeByoFlairSignup,
// the app's own established pattern for a multi-table write that must be
// all-or-nothing). webauthn_credentials cleans up on its own via that
// table's own CASCADE foreign key; nothing here needs to touch it directly.
// Every session this user has anywhere is torn down afterward, so a still-
// open tab elsewhere doesn't keep working against an account that no
// longer exists.
export async function deleteUserAccount(opts: {
  userId: string;
  email: string;
}): Promise<void> {
  await assertCanDeleteAccount(opts.userId);

  const dataSource = await AppDataSource.getInstance();
  await dataSource.transaction(async (manager) => {
    await manager
      .getRepository("InstallationMember")
      .delete({ user_id: opts.userId });
    await manager.getRepository("User").delete(opts.userId);
  });

  await invalidateAllSessionsForUser(opts.email);
}
