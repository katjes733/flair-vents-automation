import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface IUser {
  email: string;
  // '' sentinel for a delegate invited before they've completed signup —
  // see installationMember.ts's invite flow (planned, not yet built).
  password_hash: string;
  user_details: Record<string, unknown>;
}

// Deliberately thinner than tesla-powerwall-automation's own `users` table:
// no user_permissions jsonb (delegation lives in installation_members, a
// real join table — see that model's own comment for why), no
// refresh_token/expires_at (Flair tokens live in flair_tokens, keyed by
// installation_id, and a user row has no reason to know about them).
export const User = new EntitySchema<IBasicEntity & IUser>({
  name: "User",
  tableName: "users",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false, unique: true },
    password_hash: { type: "text", nullable: false },
    // No DB-level default — matching this codebase's own established
    // convention (no other jsonb column here has one either): every
    // insert site (createUser(), the BYO signup materialization) already
    // supplies an explicit value. A DB-level default was both redundant
    // and, as written, actually invalid Postgres DDL — "'{}'" quoted this
    // way emits DEFAULT ''{}'' (a syntax error), confirmed live via a
    // clean-DB boot attempt.
    user_details: { type: "jsonb", nullable: false },
  },
  indices: [{ name: "idx_users_email", columns: ["email"], unique: true }],
});
