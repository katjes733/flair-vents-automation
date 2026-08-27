// Mints the first Flair token for this installation. In client_credentials
// mode this is a plain POST + upsert; in authorization_code mode it briefly
// runs a local HTTP server to capture the browser redirect, mirroring
// tesla-powerwall-automation's scripts/getNewRefreshToken.ts. Run with:
//   bun run new-flair-token
import http from "http";
import { randomUUID } from "crypto";
import { getOrCreateDefaultInstallation } from "~/server/util/routes/installation";
import { getTokenWithClientCredentials, getTokenWithAuthorizationCode, buildFlairAuthorizeUrl } from "~/server/util/auth";
import { upsertFlairToken } from "~/server/util/routes/flairToken";

interface FlairTokenResponseBody {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function saveFromResponse(installationId: string, response: Response): Promise<void> {
  const tokenData = (await response.json()) as FlairTokenResponseBody;
  await upsertFlairToken({
    installationId,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
    scope: tokenData.scope ?? null,
  });
}

async function runClientCredentials(installationId: string): Promise<void> {
  console.log("Requesting a Flair access token via client_credentials...");
  const response = await getTokenWithClientCredentials();
  if (!response.ok) {
    console.error(`Failed: ${response.status} ${response.statusText}`);
    console.error(await response.text());
    process.exit(1);
  }
  await saveFromResponse(installationId, response);
  console.log("Flair token saved successfully.");
}

async function runAuthorizationCode(installationId: string): Promise<void> {
  const port = 3299;
  const redirectUri = `http://localhost:${port}/callback`;
  const state = randomUUID();
  const authorizeUrl = buildFlairAuthorizeUrl({ redirectUri, state });

  console.log("Open this URL in your browser to authorize:");
  console.log(authorizeUrl);
  console.log(`\nWaiting for the OAuth redirect on ${redirectUri} ...`);

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!code || returnedState !== state) {
          res.writeHead(400).end("Invalid or missing code/state.");
          server.close();
          reject(new Error("Invalid or missing code/state in OAuth redirect"));
          return;
        }
        try {
          const response = await getTokenWithAuthorizationCode(code, redirectUri);
          if (!response.ok) {
            const text = await response.text();
            res.writeHead(500).end(`Token exchange failed: ${response.status}`);
            server.close();
            reject(new Error(`Token exchange failed: ${response.status} ${text}`));
            return;
          }
          await saveFromResponse(installationId, response);
          res.writeHead(200, { "Content-Type": "text/html" }).end("<html><body>Authorization complete. You can close this tab.</body></html>");
          server.close();
          resolve();
        } catch (error) {
          res.writeHead(500).end("Unexpected error.");
          server.close();
          reject(error);
        }
      })();
    });
    server.listen(port);
  });

  console.log("Flair token saved successfully.");
}

async function main(): Promise<void> {
  const installation = await getOrCreateDefaultInstallation();
  const grantMode = process.env.FLAIR_GRANT_MODE || "client_credentials";
  if (grantMode === "authorization_code") {
    await runAuthorizationCode(installation.id);
  } else {
    await runClientCredentials(installation.id);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
