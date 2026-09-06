import type { Request } from "express";
import AppDataSource from "~/server/database/datasource";
import { withTimestamps } from "~/server/util/entityTimestamps";
import { encrypt } from "~/server/util/tokenCrypto";
import { HttpError } from "~/server/util/httpError";
import {
  getPendingSignup,
  deletePendingSignup,
} from "~/server/util/pendingSignup";
import { establishSession } from "~/server/util/sessionEstablish";
import { validateFlairCredentials } from "~/server/util/flair/bootstrapValidate";

// The real, load-bearing onboarding mechanism — see the SaaS
// Transformation plan's "Flair BYO-Credentials Onboarding" section.
// Ordering matters: the live Flair validation call happens BEFORE any
// installation/user/membership/token row is ever written, and every write
// then happens inside one transaction — there is no state where a
// half-created account exists with no working Flair connection, or a
// working Flair connection with no account attached to it.
export async function completeByoFlairSignup(opts: {
  req: Request;
  email: string;
  flairClientId: string;
  flairClientSecret: string;
}) {
  const pending = await getPendingSignup(opts.email);
  if (!pending) {
    throw new HttpError(
      "No pending signup found for this email. Please start signup again.",
      404,
    );
  }

  const validated = await validateFlairCredentials({
    clientId: opts.flairClientId,
    clientSecret: opts.flairClientSecret,
  });

  const dataSource = await AppDataSource.getInstance();
  await dataSource.transaction(async (manager) => {
    const now = new Date();

    const installationFields = withTimestamps(
      {
        name: `${opts.email}'s Home`,
        flair_structure_id: validated.structure.id,
      },
      now,
    );
    await manager.getRepository("Installation").insert(installationFields);

    const userFields = withTimestamps(
      {
        email: opts.email,
        password_hash: pending.passwordHash,
        user_details: pending.userDetails ?? {},
      },
      now,
    );
    await manager.getRepository("User").insert(userFields);

    await manager.getRepository("InstallationMember").insert(
      withTimestamps(
        {
          installation_id: installationFields.id,
          user_id: userFields.id,
          role: "owner",
          scope: { air_handler_ids: "*" },
        },
        now,
      ),
    );

    await manager.getRepository("FlairToken").insert(
      withTimestamps(
        {
          installation_id: installationFields.id,
          access_token: encrypt(validated.accessToken),
          refresh_token: null,
          expires_at: validated.expiresAt,
          scope: validated.scope,
          last_refresh_error: null,
          last_refresh_error_at: null,
          client_id: opts.flairClientId,
          client_secret: encrypt(opts.flairClientSecret),
        },
        now,
      ),
    );
  });

  // Only deleted after the transaction commits — if any write above
  // throws, the pending signup survives in Redis so the user can simply
  // retry rather than needing to restart from the email-verification step.
  await deletePendingSignup(opts.email);

  return establishSession(opts.req, opts.email);
}
