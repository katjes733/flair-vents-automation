// Logger-level secret redaction. Both tesla-powerwall-automation and
// wake-on-lan rely on a manual-only convention (never pass a secret to
// logger.*, mask emails at call sites) — this app redacts structurally
// instead, so a call site forgetting to scrub something isn't the only line
// of defense. See "Automated secret redaction" in the implementation plan.

export const REDACTED = "[REDACTED]";

// fast-redact paths (pino's `redact.paths` option) — applied before
// serialization, so this is what catches pino-http's *automatic* req/res
// logging, which no call-site convention could ever reach.
export const REDACT_PATHS = [
  "access_token",
  "*.access_token",
  "refresh_token",
  "*.refresh_token",
  "client_secret",
  "*.client_secret",
  "authorization",
  "*.authorization",
  "password",
  "*.password",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
];

const SECRET_KEY_PATTERN = /token|secret|password|authorization|api[-_]?key/i;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
// AES-256-GCM envelope shape used by tokenCrypto.ts: enc:v1:<iv>:<tag>:<data>
const ENC_ENVELOPE_PATTERN =
  /\benc:v1:[A-Za-z0-9+/=_-]+(?::[A-Za-z0-9+/=_-]+)*/gi;
const SECRET_QUERY_PARAM_PATTERN =
  /^(code|state|token|access_token|refresh_token)$/i;

const MAX_SCRUB_DEPTH = 6;

function scrubString(value: string): string {
  return value
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED}`)
    .replace(ENC_ENVELOPE_PATTERN, REDACTED);
}

/**
 * Deep-scrub for the few keys where raw Flair payloads/request bodies are
 * logged in full (flairRequest, flairResponse, payload, body) — closes the
 * gap REDACT_PATHS structurally can't reach: arbitrary-depth objects and
 * secret-shaped *values* (not just secret-named keys). Depth-capped so a
 * pathological payload can't blow the stack or balloon a log line.
 */
export function deepScrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) return "[TRUNCATED]";

  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => deepScrub(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const scrubbed: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      scrubbed[key] = SECRET_KEY_PATTERN.test(key)
        ? REDACTED
        : deepScrub(val, depth + 1);
    }
    return scrubbed;
  }
  return value;
}

function scrubUrl(url: string): string {
  const [path, query] = url.split("?");
  if (!query) return url;
  const params = new URLSearchParams(query);
  for (const key of Array.from(params.keys())) {
    if (SECRET_QUERY_PARAM_PATTERN.test(key)) {
      params.set(key, REDACTED);
    }
  }
  return `${path}?${params.toString()}`;
}

/**
 * Replacement `req` serializer: pino's stock one logs the full URL
 * including query string, which would ship an OAuth `code`/`state` (e.g.
 * `GET /callback?code=...`) to Loki verbatim. Strips known secret-shaped
 * query params from the logged URL only — never redacts URLs wholesale.
 */
export function safeReqSerializer(req: {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    method: req?.method,
    url: typeof req?.url === "string" ? scrubUrl(req.url) : req?.url,
    headers: req?.headers,
  };
}

/**
 * `hooks.logMethod` pass — catches secrets interpolated directly into a log
 * message string (e.g. `logger.info(\`token=${t}\`)`), which neither
 * REDACT_PATHS nor a field serializer can see since it's not a structured
 * field at all by the time it reaches pino.
 */
export function scrubLogArgs(inputArgs: unknown[]): unknown[] {
  return inputArgs.map((arg) =>
    typeof arg === "string" ? scrubString(arg) : arg,
  );
}
