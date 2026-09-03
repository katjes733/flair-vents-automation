// Shape ported from tesla-powerwall-automation's oauthCallback.ts, with two
// changes: email → installationId (this app has no user model, so state is
// keyed to the one installation being authorized), and the saved token now
// includes access_token + scope, not just the refresh_token — see "Token
// persistence" in the plan.

export interface OAuthState {
  value: string;
  installationId: string;
  expiresAt: number;
}

export type OAuthValidationError =
  "missing_params" | "state_expired" | "invalid_state" | "expired";

export type OAuthValidationResult =
  | { ok: true; installationId: string }
  | { ok: false; code: OAuthValidationError };

export function validateOAuthState(
  query: { code?: string; state?: string },
  stored: OAuthState | undefined,
  now: number,
): OAuthValidationResult {
  if (!query.code || !query.state) {
    return { ok: false, code: "missing_params" };
  }
  if (!stored) {
    return { ok: false, code: "state_expired" };
  }
  if (stored.value !== query.state) {
    return { ok: false, code: "invalid_state" };
  }
  if (stored.expiresAt < now) {
    return { ok: false, code: "expired" };
  }
  return { ok: true, installationId: stored.installationId };
}

interface FlairTokenResponseBody {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export type OAuthExchangeError = "exchange_failed" | "save_failed";

export type OAuthExchangeResult =
  { ok: true } | { ok: false; code: OAuthExchangeError };

export async function exchangeAndSaveToken(opts: {
  code: string;
  redirectUri: string;
  installationId: string;
  getToken: (code: string, redirectUri: string) => Promise<Response>;
  saveToken: (opts: {
    installationId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date;
    scope: string | null;
  }) => Promise<unknown>;
  onError: (code: OAuthExchangeError, error: unknown) => void;
}): Promise<OAuthExchangeResult> {
  let tokenData: FlairTokenResponseBody;
  try {
    const tokenResponse = await opts.getToken(opts.code, opts.redirectUri);
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      opts.onError("exchange_failed", errorText);
      return { ok: false, code: "exchange_failed" };
    }
    tokenData = (await tokenResponse.json()) as FlairTokenResponseBody;
  } catch (error) {
    opts.onError("exchange_failed", error);
    return { ok: false, code: "exchange_failed" };
  }

  try {
    await opts.saveToken({
      installationId: opts.installationId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? null,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
      scope: tokenData.scope ?? null,
    });
  } catch (error) {
    opts.onError("save_failed", error);
    return { ok: false, code: "save_failed" };
  }

  return { ok: true };
}
