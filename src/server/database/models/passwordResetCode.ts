import { EntitySchema } from "typeorm";
import type { IBasicEntity } from "~/server/types/common";

export interface IPasswordResetCode {
  email: string;
  // argon2-hashed TOTP code, never stored raw — see passwordReset.ts.
  code: string;
  expires_at: Date;
}

// Deliberately a separate table from signup_verification, not a reuse of
// it, even though the shape is identical — the two codes mean genuinely
// different things (proof of a new email address vs. proof of ownership of
// an existing account's inbox), and signup_verification's own established
// behavior of staying valid until it expires or is overwritten (see
// signupVerification.ts's own comment) is the wrong default for a password
// reset code specifically: this one must be single-use, consumed the
// moment it resets a password, so a captured/logged code can't reset the
// same password again inside its TTL window.
export const PasswordResetCode = new EntitySchema<
  IBasicEntity & IPasswordResetCode
>({
  name: "PasswordResetCode",
  tableName: "password_reset_codes",
  columns: {
    id: { type: "uuid", primary: true, generated: "uuid", nullable: false },
    creation_time: { type: "timestamp with time zone", nullable: false },
    modified_time: { type: "timestamp with time zone", nullable: false },
    email: { type: "varchar", length: 255, nullable: false },
    code: { type: "varchar", nullable: false },
    expires_at: { type: "timestamp with time zone", nullable: false },
  },
  indices: [
    {
      name: "idx_password_reset_codes_email",
      columns: ["email"],
      unique: true,
    },
  ],
});
