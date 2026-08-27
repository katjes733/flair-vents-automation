import { describe, it, expect } from "vitest";
import { PassThrough } from "stream";
import createLogger from "~/server/log";

// Builds a real Pino logger writing to an in-memory sink and asserts the
// *raw emitted bytes* never contain a secret substring — this is the
// enforcement mechanism for "Automated secret redaction" in the
// implementation plan, not documentation of intent. A new secret-shaped
// field requires a new fixture case here; that's the CI gate.

function collectLogs(): { stream: PassThrough; getOutput: () => string } {
  const stream = new PassThrough();
  let output = "";
  stream.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  return { stream, getOutput: () => output };
}

function makeLogger(stream: PassThrough) {
  return createLogger(
    { LOG_LEVEL: "trace", LOG_PRETTY_PRINT: "false" },
    stream,
  );
}

describe("log redaction", () => {
  it("redacts a top-level access_token field", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info({ access_token: "top-level-secret-1" }, "token minted");
    expect(getOutput()).not.toContain("top-level-secret-1");
  });

  it("redacts a nested refresh_token field one level deep", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(
      { tokenData: { refresh_token: "nested-secret-2" } },
      "token refreshed",
    );
    expect(getOutput()).not.toContain("nested-secret-2");
  });

  it("redacts req.headers.authorization via pino-http-style automatic logging", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(
      {
        req: {
          method: "GET",
          url: "/health",
          headers: { authorization: "Bearer secret-3" },
        },
      },
      "request received",
    );
    expect(getOutput()).not.toContain("secret-3");
  });

  it("strips a secret-shaped query string from a logged URL without redacting the whole URL", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(
      {
        req: {
          method: "GET",
          url: "/api/v1/flair-auth/callback?code=oauth-code-4&state=oauth-state-4",
          headers: {},
        },
      },
      "callback hit",
    );
    const output = getOutput();
    expect(output).not.toContain("oauth-code-4");
    expect(output).not.toContain("oauth-state-4");
    // The path itself must survive — this isn't a blanket URL redaction.
    expect(output).toContain("/api/v1/flair-auth/callback");
  });

  it("scrubs a bearer token interpolated directly into a log message string", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(`Outgoing request used Bearer secret-token-5`);
    expect(getOutput()).not.toContain("secret-token-5");
  });

  it("scrubs an enc:v1: envelope interpolated into a log message string", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(`Persisted enc:v1:aaaa:bbbb:secret-payload-6`);
    expect(getOutput()).not.toContain("secret-payload-6");
  });

  it("deep-scrubs an enc:v1: envelope by content, inside a payload field whose own key isn't secret-shaped", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(
      { payload: { storedValue: "enc:v1:aaaa:bbbb:secret-payload-6" } },
      "token persisted",
    );
    expect(getOutput()).not.toContain("secret-payload-6");
  });

  it("deep-scrubs an arbitrarily nested secret inside a flairResponse field", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(
      {
        flairResponse: {
          data: {
            attributes: {
              nested: { deeper: { client_secret: "deep-secret-7" } },
            },
          },
        },
      },
      "flair response received",
    );
    expect(getOutput()).not.toContain("deep-secret-7");
  });

  it("deep-scrubs a payload field regardless of key casing", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(
      {
        payload: { Authorization: "Bearer secret-8", refreshToken: "secret-9" },
      },
      "outbound call",
    );
    const output = getOutput();
    expect(output).not.toContain("secret-8");
    expect(output).not.toContain("secret-9");
  });

  it("does not redact ordinary, non-secret fields", () => {
    const { stream, getOutput } = collectLogs();
    const logger = makeLogger(stream);
    logger.info(
      { zone_id: "zone-123", desired_position_pct: 42 },
      "zone evaluated",
    );
    const output = getOutput();
    expect(output).toContain("zone-123");
    expect(output).toContain("42");
  });
});
