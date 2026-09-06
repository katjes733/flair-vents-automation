import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import { Installation } from "~/server/database/models/installation";
import { User } from "~/server/database/models/user";

export type InstallationMemberRole = "owner" | "admin" | "write" | "read";

export interface IInstallationMemberScope {
  // "*" (the default) means every air handler on this installation; a
  // finer-grained delegate grant lists specific ids instead. Zone-level
  // scoping, if ever needed, is a new key inside this same jsonb blob
  // (zone_ids), not a schema change — see the SaaS Transformation plan's
  // own "Delegate and Multi-User Access" section.
  air_handler_ids: string[] | "*";
}

export interface IInstallationMember {
  installation_id: string;
  user_id: string;
  role: InstallationMemberRole;
  scope: IInstallationMemberScope;
}

// The real join table tesla-powerwall-automation never had the chance to
// build — that app derives "owner" from RefreshToken existence and stores
// delegate grants in a jsonb array on the delegate's own users row,
// specifically because it has no first-class tenant entity to hang a real
// join table off. This app already has that entity (installations), so
// role/scope live here as real, queryable, revocable rows from day one —
// the exact retrofit this table exists to avoid repeating.
//
// Both FKs are RESTRICT, not CASCADE — matching zones.air_handler_id's own
// convention: deleting a user who still holds memberships, or an
// installation that still has members, must be a deliberate multi-step
// operation, never a silent cascade. This matters concretely for the
// "every installation must retain at least one owner" invariant (enforced
// at the service layer, not expressible as a CHECK constraint) — an
// ON DELETE CASCADE could silently strip an installation to zero owners
// with no chance to check first.
export const InstallationMember = new EntitySchema<
  IBasicEntity & IInstallationMember
>({
  name: "InstallationMember",
  tableName: "installation_members",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    installation_id: { type: "uuid", nullable: false },
    user_id: { type: "uuid", nullable: false },
    role: { type: "varchar", length: 20, nullable: false },
    // No DB-level default — matching this codebase's own established
    // convention (no other jsonb column here has one). See user.ts's own
    // user_details column comment for why: every insert site already
    // supplies an explicit value, and a DB-level default for a jsonb
    // column is easy to get wrong here — confirmed live, this exact
    // shape produced invalid DDL (TypeORM re-quotes an already-quoted
    // default string) the one time it was tried.
    scope: { type: "jsonb", nullable: false },
  },
  indices: [
    {
      name: "idx_installation_members_installation_user",
      columns: ["installation_id", "user_id"],
      unique: true,
    },
    { name: "idx_installation_members_user", columns: ["user_id"] },
    {
      name: "idx_installation_members_installation",
      columns: ["installation_id"],
    },
  ],
  foreignKeys: [
    {
      name: "fk_installation_members_installation",
      columnNames: ["installation_id"],
      target: Installation,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
    {
      name: "fk_installation_members_user",
      columnNames: ["user_id"],
      target: User,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
});
