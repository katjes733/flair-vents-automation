import type { Request } from "express";
import { resolveActor } from "~/server/util/resolveActor";
import { clearLockout } from "~/server/util/authLockout";
import { getInstallationById } from "~/server/util/routes/installation";
import { registerSession } from "~/server/util/sessionRegistry";

// Resolves the extra fields the client needs alongside the login identity.
// A login with no accessible installation yet is a legitimate transient
// state during signup (email + password verified, but BYO Flair
// credentials not yet submitted/validated — see the Flair BYO-Credentials
// Onboarding stage), not a login failure — it's reported with
// installationLinked: false so the client routes them to the "connect your
// Flair account" step instead of the dashboard. Any other resolution error
// (ambiguous / not_authorized_for_installation) still returns null.
export async function buildSessionUser(loginEmail: string) {
  const result = await resolveActor(loginEmail);
  if ("error" in result) {
    if (result.error !== "no_access") return null;
    return {
      loginEmail,
      installationId: null,
      installationName: null,
      role: null,
      profile: null,
      installationLinked: false,
    };
  }
  // resolveActor's own Actor shape carries installationId only, not the
  // installation's human-readable name (it's the tenant-scoping identity,
  // not display data) — the client still wants it (e.g. "Connected to
  // Martin's Home"), so it's resolved here, once, at the one place the
  // client's own session response is actually built.
  const installation = await getInstallationById(result.installationId);
  return {
    loginEmail: result.loginEmail,
    installationId: result.installationId,
    installationName: installation?.name ?? null,
    role: result.role,
    profile: result.profile,
    installationLinked: true,
  };
}

// Shared by password login and passkey login (once passkeys land) —
// establishes the authenticated session identically regardless of which
// credential the user proved.
export async function establishSession(req: Request, email: string) {
  await clearLockout(email);
  req.session.user = email;
  if (!req.session.expiry) {
    req.session.expiry = Date.now() + (req.session.cookie.maxAge || 3600000);
  }
  await registerSession(email, req.sessionID);
  return {
    message: "Logged in",
    user: await buildSessionUser(email),
    sessionExpiry: req.session.expiry,
  };
}
