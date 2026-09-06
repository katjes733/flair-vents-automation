import AppDataSource, { qualifiedTable } from "~/server/database/datasource";
import { withTimestamps } from "~/server/util/entityTimestamps";
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
}): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "InstallationMember",
  );
  await repo.insert(
    withTimestamps({
      installation_id: opts.installationId,
      user_id: opts.userId,
      role: opts.role,
      scope: opts.scope ?? { air_handler_ids: "*" },
    }),
  );
}

// Counts owner rows for an installation — used to enforce "an installation
// must always retain at least one owner" before a revoke/role-change is
// allowed to proceed (see the SaaS Transformation plan's "Delegate and
// Multi-User Access" section). Not yet called from any route — the invite/
// revoke UI itself is a later, deferred stage — but the accessor exists now
// so that stage is "add routes," not "add routes and this query."
export async function countOwners(installationId: string): Promise<number> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "InstallationMember",
  );
  return repo.count({
    where: { installation_id: installationId, role: "owner" },
  });
}
