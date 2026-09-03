// A pure render function — no Express dependency — so the callback page's
// content is directly unit-testable. Only relevant in authorization_code
// mode; dormant otherwise. Adapted from tesla-powerwall-automation's
// /callback page (self-contained, no external resources, so it gets its own
// tight per-response CSP with a nonce rather than relaxing the app-wide
// helmet policy).

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  missing_params: "Flair did not return the expected authorization code.",
  state_expired:
    "Your authorization attempt expired before completing. Please try again.",
  invalid_state:
    "This authorization link is no longer valid. Please try again.",
  expired:
    "This authorization attempt took too long and expired. Please try again.",
  exchange_failed: "Flair rejected the authorization code. Please try again.",
  save_failed:
    "The new Flair token could not be saved. Please try again or contact support.",
};

export function renderOAuthCallbackPage(opts: {
  success: boolean;
  code?: string;
  nonce: string;
}): string {
  const heading = opts.success
    ? "Authorization Successful"
    : "Authorization Failed";
  const message = opts.success
    ? "Your Flair authorization has been updated. This tab will close automatically."
    : (OAUTH_ERROR_MESSAGES[opts.code || ""] ??
      "Something went wrong during authorization.");
  const script = opts.success
    ? `window.opener && window.opener.postMessage({ source: "flair-oauth", status: "success" }, window.location.origin);
        setTimeout(function () { window.close(); }, 1500);`
    : `window.opener && window.opener.postMessage({ source: "flair-oauth", status: "error", code: ${JSON.stringify(opts.code || "unknown")} }, window.location.origin);`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${heading}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root { --bg-color: #ffffff; --text-color: #333; --accent-color: #007acc; color-scheme: light dark; }
    @media (prefers-color-scheme: dark) {
      :root { --bg-color: #121212; --text-color: #e4e6eb; --accent-color: #58a6ff; }
    }
    body { margin: 0; padding: 2rem; background-color: var(--bg-color); color: var(--text-color); font-family: system-ui, sans-serif; text-align: center; }
    h1 { margin-top: 0; font-size: 2rem; }
    p { font-size: 1rem; }
    button { margin-top: 1rem; padding: 0.5rem 1.5rem; font-size: 1rem; border-radius: 6px; border: 1px solid var(--accent-color); background: transparent; color: var(--accent-color); cursor: pointer; }
  </style>
  <script nonce="${opts.nonce}">
    window.addEventListener('load', function() {
      ${script}
      document.getElementById('oauth-close-btn').addEventListener('click', function () { window.close(); });
    });
  </script>
</head>
<body>
  <h1>${heading}</h1>
  <p>${message}</p>
  <button id="oauth-close-btn">Close this tab</button>
</body>
</html>`;
}
