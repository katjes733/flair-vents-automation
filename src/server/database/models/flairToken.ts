import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import { Installation } from "~/server/database/models/installation";

export interface IFlairToken {
  installation_id: string;
  // Both stored encrypted (enc:v1:<iv>:<tag>:<data> envelope) — see
  // tokenCrypto.ts, ported verbatim from tesla-powerwall-automation.
  // refresh_token is nullable — absent under client_credentials grant mode.
  refresh_token: string | null;
  access_token: string | null;
  expires_at: Date | null;
  scope: string | null;
  last_refresh_error: string | null;
  last_refresh_error_at: Date | null;
}

// One Flair account per installation — superseding an earlier free-text
// account_key design now that a real tenant entity exists to reference.
// installation_id is UNIQUE, not just a plain FK: zero cost today, but
// doesn't need a migration if a second Flair account ever appears (Data
// Model / flair_tokens section).
export const FlairToken = new EntitySchema<IBasicEntity & IFlairToken>({
  name: "FlairToken",
  tableName: "flair_tokens",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    installation_id: { type: "uuid", nullable: false, unique: true },
    refresh_token: { type: "varchar", nullable: true },
    access_token: { type: "varchar", nullable: true },
    expires_at: { type: "timestamp with time zone", nullable: true },
    scope: { type: "varchar", length: 255, nullable: true },
    last_refresh_error: { type: "varchar", nullable: true },
    last_refresh_error_at: { type: "timestamp with time zone", nullable: true },
  },
  foreignKeys: [
    {
      name: "fk_flair_tokens_installation",
      columnNames: ["installation_id"],
      target: Installation,
      referencedColumnNames: ["id"],
      onDelete: "RESTRICT",
    },
  ],
});
