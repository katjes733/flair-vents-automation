// One postTokenRequest() + three grant callers. `scope` is sent in the body
// on every call (not just an authorize URL) since an insufficient_scope
// error would otherwise surface later, on a resource call, far from the
// token code — see the plan's "Token persistence" section. The actual
// scope string Flair expects is unconfirmed pending Phase 0 / account
// setup, so it's read from an optional FLAIR_SCOPE env var rather than
// hardcoded.
//
// Every function below takes credentials in as an explicit parameter
// rather than reading FLAIR_CLIENT_ID/FLAIR_CLIENT_SECRET from the
// environment internally — a deliberate change for multi-tenant BYO
// credentials (see the SaaS Transformation plan's "Flair BYO-Credentials
// Onboarding" section): each installation brings its own Client ID/Secret,
// so this module can no longer assume there's exactly one global pair.
// Callers that still legitimately want the global env-configured pair
// (the dormant authorization_code flow, which stays "global, not
// per-installation" per that same plan section) read it themselves via
// getEnvFlairCredentials() and pass it in like any other caller.

export interface FlairCredentials {
  clientId: string;
  clientSecret: string;
}

export function getEnvFlairCredentials(): FlairCredentials {
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

export async function getTokenWithClientCredentials(
  credentials: FlairCredentials,
): Promise<Response> {
  return postTokenRequest({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope: process.env.FLAIR_SCOPE,
  });
}

export async function getTokenWithAuthorizationCode(
  credentials: FlairCredentials,
  code: string,
  redirectUri: string,
): Promise<Response> {
  return postTokenRequest({
    grant_type: "authorization_code",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code,
    redirect_uri: redirectUri,
    scope: process.env.FLAIR_SCOPE,
  });
}

export async function getTokenWithRefreshToken(
  credentials: FlairCredentials,
  refreshToken: string,
): Promise<Response> {
  return postTokenRequest({
    grant_type: "refresh_token",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: refreshToken,
    scope: process.env.FLAIR_SCOPE,
  });
}

// Only relevant in authorization_code mode — dormant (never called) under
// client_credentials, where there's no browser redirect at all.
export function buildFlairAuthorizeUrl(
  credentials: Pick<FlairCredentials, "clientId">,
  opts: { redirectUri: string; state: string },
): string {
  const url = new URL("/oauth2/authorize", baseAuthUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  if (process.env.FLAIR_SCOPE)
    url.searchParams.set("scope", process.env.FLAIR_SCOPE);
  return url.toString();
}
