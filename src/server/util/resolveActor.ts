import { listAccessibleInstallations } from "~/server/util/routes/installationMember";
import { getUserByEmail } from "~/server/util/routes/user";
import type { Actor, ActorSource } from "~/server/util/actor";
import type { InstallationMemberRole } from "~/server/database/models/installationMember";
import type { IInstallationMemberScope } from "~/server/database/models/installationMember";
import type { ProfileName } from "~/shared/permissions/profile";

// owner and admin both resolve to the same permission profile — the
// distinction between them is real but lives outside the ActionSchema
// entirely (only an owner can create/remove another owner; an installation
// must always retain at least one owner) — see installationMember.ts's own
// model comment and the SaaS Transformation plan's "User and Account Data
// Model" section for why this couldn't just be a derived fact the way
// tesla-powerwall-automation treats "owner".
function roleToProfile(role: InstallationMemberRole): ProfileName {
  if (role === "owner" || role === "admin") return "admin";
  return role;
}

export interface AccessibleInstallationChoice {
  installationId: string;
  installationName: string;
  role: InstallationMemberRole;
  scope: IInstallationMemberScope;
  source: Exclude<ActorSource, "system">;
}

// Today every membership row's source is "member" — there is no "owner
// derived from a side signal" concept the way tesla-powerwall-automation's
// RefreshToken-existence trick works, since ownership here is a real,
// stored role value (installation_members.role) rather than something
// inferred. The type still carries `source` because the Actor shape needs
// one, and "system" (the control loop) is a genuinely different case.
export async function listAccessibleInstallationChoices(
  userId: string,
): Promise<AccessibleInstallationChoice[]> {
  const rows = await listAccessibleInstallations(userId);
  return rows.map((row) => ({
    installationId: row.installationId,
    installationName: row.installationName,
    role: row.role,
    scope: row.scope,
    source: "member" as const,
  }));
}

export type SelectInstallationResult =
  | AccessibleInstallationChoice
  | { error: "no_access" | "ambiguous" | "not_authorized_for_installation" };

// Picks which of listAccessibleInstallationChoices(...) applies to a given
// request. Today there's always exactly one candidate in practice (one
// user, one installation, per the BYO onboarding flow's own atomic
// materialization), but this already supports an optional
// X-Installation-Id request header for when a login ends up with multiple
// accessible installations (a delegate, or a user who owns more than one
// household) in the future — see the SaaS Transformation plan's "User and
// Account Data Model" section.
export function selectActiveInstallation(
  choices: AccessibleInstallationChoice[],
  requestedInstallationId?: string,
): SelectInstallationResult {
  if (choices.length === 0) return { error: "no_access" };
  if (requestedInstallationId) {
    const match = choices.find(
      (c) => c.installationId === requestedInstallationId,
    );
    return match ?? { error: "not_authorized_for_installation" };
  }
  if (choices.length === 1) return choices[0];
  const owner = choices.find((c) => c.role === "owner");
  if (owner) return owner;
  return { error: "ambiguous" };
}

// Single entry point, mirroring tesla-powerwall-automation's own
// resolveActor(loginEmail, ...) signature — looks the user up by email
// first (the only identity the session itself stores, per
// sessionEstablish.ts), then resolves which installation this request acts
// on. A login with no matching users row at all (should never happen for
// an authenticated session, since establishSession only ever sets
// req.session.user to a real, just-verified email) is treated the same as
// "no accessible installations" rather than thrown, so a caller only ever
// has one error shape to handle.
export async function resolveActor(
  loginEmail: string,
  requestedInstallationId?: string,
): Promise<
  | Actor
  | { error: "no_access" | "ambiguous" | "not_authorized_for_installation" }
> {
  const user = await getUserByEmail(loginEmail);
  if (!user) return { error: "no_access" };
  const choices = await listAccessibleInstallationChoices(user.id);
  const selected = selectActiveInstallation(choices, requestedInstallationId);
  if ("error" in selected) return selected;
  return {
    loginEmail,
    source: selected.source,
    installationId: selected.installationId,
    role: selected.role,
    profile: roleToProfile(selected.role),
    // The DB/jsonb column is snake_case (air_handler_ids, matching this
    // app's own jsonb-field-naming convention); the in-memory Actor is
    // camelCase (airHandlerIds, matching every other TS interface here) —
    // this is the one place that translation happens.
    scope: { airHandlerIds: selected.scope.air_handler_ids },
  };
}
