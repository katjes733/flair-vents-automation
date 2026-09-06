import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";
import { User } from "~/server/database/models/user";

export interface IWebauthnCredential {
  user_id: string;
  credential_id: string;
  public_key: string;
  sign_counter: number;
  transports: string[] | null;
  device_type: "singleDevice" | "multiDevice";
  backed_up: boolean;
  nickname: string | null;
  last_used_at: Date | null;
}

// Ported from tesla-powerwall-automation's own working passkey model,
// verbatim in shape. user_id's FK is CASCADE here — a deliberate contrast
// with installation_members' own RESTRICT: a passkey has zero independent
// meaning without its user, so deleting the user should take their own
// login credentials with it, whereas an installation_members row is a
// real tenant-access grant that must never silently cascade away.
//
// The table is created now (Stage 1, "Auth foundation") so the schema
// lands in one migration; the actual @simplewebauthn/* registration/login
// ceremonies that populate it are a separate, later stage.
export const WebauthnCredential = new EntitySchema<
  IBasicEntity & IWebauthnCredential
>({
  name: "WebauthnCredential",
  tableName: "webauthn_credentials",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    user_id: { type: "uuid", nullable: false },
    credential_id: { type: "varchar", unique: true, nullable: false },
    public_key: { type: "text", nullable: false },
    sign_counter: { type: "bigint", nullable: false, default: 0 },
    transports: { type: "jsonb", nullable: true },
    device_type: { type: "varchar", length: 32, nullable: false },
    backed_up: { type: "boolean", nullable: false, default: false },
    nickname: { type: "varchar", length: 255, nullable: true },
    last_used_at: { type: "timestamp with time zone", nullable: true },
  },
  indices: [
    {
      name: "idx_webauthn_credentials_credential_id",
      columns: ["credential_id"],
      unique: true,
    },
    { name: "idx_webauthn_credentials_user_id", columns: ["user_id"] },
  ],
  foreignKeys: [
    {
      name: "fk_webauthn_credentials_user_id",
      columnNames: ["user_id"],
      target: User,
      referencedColumnNames: ["id"],
      onDelete: "CASCADE",
    },
  ],
});
