// One postTokenRequest() + three grant callers, all behind FLAIR_GRANT_MODE —
// Phase 0 confirming which grant this account needs becomes a config flip,
// not a rewrite. `scope` is sent in the body on every call (not just an
// authorize URL) since an insufficient_scope error would otherwise surface
// later, on a resource call, far from the token code — see the plan's
// "Token persistence" section. The actual scope string Flair expects is
// unconfirmed pending Phase 0 / account setup, so it's read from an
// optional FLAIR_SCOPE env var rather than hardcoded.

function requireCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FLAIR_CLIENT_ID;
  const clientSecret = process.env.FLAIR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing required environment variables: FLAIR_CLIENT_ID or FLAIR_CLIENT_SECRET",
    );
  }
  return { clientId, clientSecret };
}

function baseAuthUrl(): string {
  return process.env.FLAIR_API_BASE_URL || "https://api.flair.co";
}

async function postTokenRequest(
  params: Record<string, string | undefined>,
): Promise<Response> {
  const tokenEndpoint = new URL("/oauth2/token", baseAuthUrl()).toString();
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.append(key, value);
  }
  return fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

export async function getTokenWithClientCredentials(): Promise<Response> {
  const { clientId, clientSecret } = requireCredentials();
  return postTokenRequest({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: process.env.FLAIR_SCOPE,
  });
}

export async function getTokenWithAuthorizationCode(
  code: string,
  redirectUri: string,
): Promise<Response> {
  const { clientId, clientSecret } = requireCredentials();
  return postTokenRequest({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    scope: process.env.FLAIR_SCOPE,
  });
}

export async function getTokenWithRefreshToken(
  refreshToken: string,
): Promise<Response> {
  const { clientId, clientSecret } = requireCredentials();
  return postTokenRequest({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    scope: process.env.FLAIR_SCOPE,
  });
}

// Only relevant in authorization_code mode — dormant (never called) under
// client_credentials, where there's no browser redirect at all.
export function buildFlairAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
}): string {
  const { clientId } = requireCredentials();
  const url = new URL("/oauth2/authorize", baseAuthUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  if (process.env.FLAIR_SCOPE)
    url.searchParams.set("scope", process.env.FLAIR_SCOPE);
  return url.toString();
}
