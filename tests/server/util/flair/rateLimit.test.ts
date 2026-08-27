import { describe, it, expect } from "vitest";
import { getRetryAfterMs } from "~/server/util/flair/rateLimit";

function resWithHeader(value: string | null) {
  return { headers: { get: () => value } };
}

describe("getRetryAfterMs", () => {
  it("returns null when there's no Retry-After header", () => {
    expect(getRetryAfterMs(resWithHeader(null))).toBeNull();
  });

  it("parses a numeric (seconds) Retry-After", () => {
    expect(getRetryAfterMs(resWithHeader("5"))).toBe(5000);
  });

  it("parses an HTTP-date Retry-After relative to now", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const ms = getRetryAfterMs(resWithHeader(future));
    expect(ms).toBeGreaterThan(8000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  it("never returns a negative delay for a Retry-After in the past", () => {
    const past = new Date(Date.now() - 10_000).toUTCString();
    expect(getRetryAfterMs(resWithHeader(past))).toBe(0);
  });

  it("returns null for an unparseable header value", () => {
    expect(getRetryAfterMs(resWithHeader("not-a-real-value"))).toBeNull();
  });
});
