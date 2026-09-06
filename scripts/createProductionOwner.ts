// One-time migration script for the SaaS Transformation's "Installation-
// scoping migration" stage — see the plan's own "Migration Path From
// Today's Single-Tenant Runtime" section for the full reasoning.
//
// There is exactly one real installation row today, running in production
// with real zones/schedules/settings/flair_tokens already correctly tied
// to it. This script creates the real owner account for that SAME
// existing installation — it does NOT create a new installation, and it
// does NOT touch any existing zone/schedule/settings/override row.
//
// Deliberately NOT the BYO-credentials signup flow: that flow requires
// live-validating a freshly-submitted Flair Client ID/Secret before
// creating anything, but this installation already has a working
// flair_tokens row tied to the current .env FLAIR_CLIENT_ID/
// FLAIR_CLIENT_SECRET values — there's nothing to validate, only to
// backfill the two new columns those values now belong in.
//
// Idempotent: safe to re-run. Each step checks whether it already applied
// (a user with this email, a membership row for that user+installation, a
// flair_tokens row that already has client_id/client_secret set) and skips
// with a clear message rather than erroring or duplicating.
//
// Run with:
//   bun run scripts/createProductionOwner.ts <email>
// The password is never a CLI argument — it's read via a masked interactive
// prompt (twice, to catch typos), so the real production password never
// lands in shell history or a `ps` listing.
//
// This writes to whichever database the current environment (.env) points
// at — confirm that's really production (or a deliberate migration
// rehearsal against a copy) before running it, per this app's own "never
// touch production without confirming first" convention.

import argon2 from "argon2";
import AppDataSource from "~/server/database/datasource";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { getUserByEmail, createUser } from "~/server/util/routes/user";
import {
  listAccessibleInstallations,
  createInstallationMember,
} from "~/server/util/routes/installationMember";
import {
  getFlairTokenByInstallation,
  resolveFlairCredentials,
  setFlairCredentials,
} from "~/server/util/routes/flairToken";

const ENTER_KEYS = new Set(["\n", "\r"]);
const BACKSPACE_KEYS = new Set(["\u007f", "\b"]);
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";

// Reads a password from stdin without echoing it, masking each keystroke
// with "*" instead — the whole reason this exists rather than an argv
// param is to keep a real production password out of shell history/`ps`.
function promptPassword(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode?.(true);
    stdin.setEncoding("utf8");

    let password = "";
    const onData = (char: string): void => {
      if (ENTER_KEYS.has(char) || char === CTRL_D) {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(password);
      } else if (char === CTRL_C) {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        reject(new Error("Cancelled."));
      } else if (BACKSPACE_KEYS.has(char)) {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        password += char;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

async function promptNewPassword(): Promise<string> {
  const password = await promptPassword("New owner password: ");
  const confirmation = await promptPassword("Confirm password: ");
  if (password !== confirmation) {
    throw new Error("Passwords didn't match — run the script again.");
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  return password;
}

async function main(): Promise<void> {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: bun run scripts/createProductionOwner.ts <email>");
    process.exit(1);
  }

  await AppDataSource.getInstance();

  const installation = await getOrCreateDefaultInstallation();
  console.log(
    `Target installation: "${installation.name}" (${installation.id})`,
  );

  // Step 1 — the real users row.
  let user = await getUserByEmail(email);
  if (user) {
    console.log(`User ${email} already exists (${user.id}) — reusing it.`);
  } else {
    const password = await promptNewPassword();
    user = await createUser({
      email,
      passwordHash: await argon2.hash(password),
    });
    console.log(`Created user ${email} (${user.id}).`);
  }

  // Step 2 — the owner membership row for this exact installation.
  const existingMemberships = await listAccessibleInstallations(user.id);
  const alreadyMember = existingMemberships.some(
    (m) => m.installationId === installation.id,
  );
  if (alreadyMember) {
    console.log(
      `User ${email} is already a member of this installation — skipping.`,
    );
  } else {
    await createInstallationMember({
      installationId: installation.id,
      userId: user.id,
      role: "owner",
    });
    console.log(`Granted ${email} the owner role on this installation.`);
  }

  // Step 3 — backfill flair_tokens.client_id/client_secret from the
  // current .env values, only if they aren't already set (never silently
  // overwrite a value someone may have already set deliberately).
  const existingToken = await getFlairTokenByInstallation(installation.id);
  const clientId = process.env.FLAIR_CLIENT_ID;
  const clientSecret = process.env.FLAIR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn(
      "FLAIR_CLIENT_ID/FLAIR_CLIENT_SECRET are not set in this environment " +
        "— skipping the flair_tokens backfill. FlairApiClient will keep " +
        "falling back to these same env vars at request time either way " +
        "(see client.ts's resolveCredentials()), so this is not blocking, " +
        "but it should be backfilled for real before this installation is " +
        "treated as fully migrated.",
    );
  } else if (!existingToken) {
    console.warn(
      "No flair_tokens row exists yet for this installation — nothing to " +
        "backfill client_id/client_secret onto. This is unexpected for the " +
        "one pre-existing production installation; investigate before " +
        "proceeding.",
    );
  } else {
    // setFlairCredentials() always overwrites — cheap idempotency check
    // done here instead, at the call site, so a re-run doesn't silently
    // clobber a value that may have already been set (e.g. by a real BYO
    // onboarding, however unlikely for this specific installation).
    const alreadyBackfilled = Boolean(
      await resolveFlairCredentials(installation.id),
    );
    if (alreadyBackfilled) {
      console.log(
        "flair_tokens.client_id is already set for this installation — skipping.",
      );
    } else {
      await setFlairCredentials({
        installationId: installation.id,
        clientId,
        clientSecret,
      });
      console.log(
        "Backfilled flair_tokens.client_id/client_secret from the current " +
          "environment's FLAIR_CLIENT_ID/FLAIR_CLIENT_SECRET.",
      );
    }
  }

  console.log(
    `\nDone. ${email} can now log in at /login and will land on this installation's dashboard.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
