import AppDataSource, { qualifiedTable } from "~/server/database/datasource";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";
import type {
  IInstallationMemberScope,
  InstallationMemberRole,
} from "~/server/database/models/installationMember";

export interface AccessibleInstallation {
  installationId: string;
  installationName: string;
  role: InstallationMemberRole;
  scope: IInstallationMemberScope;
}

// A plain indexed join — the direct payoff of installation_members being a
// real table rather than tesla-powerwall-automation's own jsonb-on-user
// delegation array, which needs a GIN-indexed jsonb-containment scan across
// every users row to answer the equivalent question.
export async function listAccessibleInstallations(
  userId: string,
): Promise<AccessibleInstallation[]> {
  const dataSource = await AppDataSource.getInstance();
  const rows = await dataSource.query(
    `SELECT im.installation_id, i.name AS installation_name, im.role, im.scope
     FROM ${qualifiedTable("installation_members")} im
     JOIN ${qualifiedTable("installations")} i ON i.id = im.installation_id
     WHERE im.user_id = $1`,
    [userId],
  );
  return rows.map(
    (row: {
      installation_id: string;
      installation_name: string;
      role: InstallationMemberRole;
      scope: IInstallationMemberScope;
    }) => ({
      installationId: row.installation_id,
      installationName: row.installation_name,
      role: row.role,
      scope: row.scope,
    }),
  );
}

export async function createInstallationMember(opts: {
  installationId: string;
  userId: string;
  role: InstallationMemberRole;
  scope?: IInstallationMemberScope;
}): Promise<{ id: string; createdAt: Date }> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "InstallationMember",
  );
  const fields = withTimestamps({
    installation_id: opts.installationId,
    user_id: opts.userId,
    role: opts.role,
    scope: opts.scope ?? { air_handler_ids: "*" },
  });
  await repo.insert(fields);
  return { id: fields.id, createdAt: fields.creation_time };
}

// Counts owner rows for an installation — used to enforce "an installation
// must always retain at least one owner" before a revoke/role-change is
// allowed to proceed (see the SaaS Transformation plan's "Delegate and
// Multi-User Access" section).
export async function countOwners(installationId: string): Promise<number> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "InstallationMember",
  );
  return repo.count({
    where: { installation_id: installationId, role: "owner" },
  });
}

export interface InstallationMemberRow {
  id: string;
  installationId: string;
  userId: string;
  email: string;
  role: InstallationMemberRole;
  scope: IInstallationMemberScope;
  createdAt: Date;
}

// The Members page's own listing — the inverse join of
// listAccessibleInstallations (by installation instead of by user),
// including each member's email since a raw user_id means nothing in a UI.
export async function listMembersForInstallation(
  installationId: string,
): Promise<InstallationMemberRow[]> {
  const dataSource = await AppDataSource.getInstance();
  const rows = await dataSource.query(
    `SELECT im.id, im.installation_id, im.user_id, u.email, im.role, im.scope, im.creation_time
     FROM ${qualifiedTable("installation_members")} im
     JOIN ${qualifiedTable("users")} u ON u.id = im.user_id
     WHERE im.installation_id = $1
     ORDER BY im.creation_time ASC`,
    [installationId],
  );
  return rows.map(
    (row: {
      id: string;
      installation_id: string;
      user_id: string;
      email: string;
      role: InstallationMemberRole;
      scope: IInstallationMemberScope;
      creation_time: Date;
    }) => ({
      id: row.id,
      installationId: row.installation_id,
      userId: row.user_id,
      email: row.email,
      role: row.role,
      scope: row.scope,
      createdAt: row.creation_time,
    }),
  );
}

export async function getInstallationMemberById(
  id: string,
): Promise<InstallationMemberRow | null> {
  const dataSource = await AppDataSource.getInstance();
  const rows = await dataSource.query(
    `SELECT im.id, im.installation_id, im.user_id, u.email, im.role, im.scope, im.creation_time
     FROM ${qualifiedTable("installation_members")} im
     JOIN ${qualifiedTable("users")} u ON u.id = im.user_id
     WHERE im.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    installationId: row.installation_id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    scope: row.scope,
    createdAt: row.creation_time,
  };
}

export async function updateInstallationMember(
  id: string,
  patch: { role?: InstallationMemberRole; scope?: IInstallationMemberScope },
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "InstallationMember",
  );
  await repo.update(id, { ...patch, ...touch() });
}

export async function deleteInstallationMember(id: string): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "InstallationMember",
  );
  await repo.delete(id);
}
