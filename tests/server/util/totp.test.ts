import { describe, it, expect } from "vitest";
import { totp, generateKey } from "otp-io";
import { randomBytes } from "otp-io/crypto";
import { hmac } from "~/server/util/totp";

describe("hmac", () => {
  // Regression test for a real, confirmed bug: otp-io's own HmacAlgorithm
  // enum passes lowercase, hyphen-less algorithm names ("sha1"), but Web
  // Crypto's SubtleCrypto requires the standard "SHA-1" form and throws
  // "Unrecognized algorithm name" otherwise — caught live by this test
  // failing with exactly that error before the fix normalized the name.
  it("computes a real HMAC-SHA1 digest for otp-io's lowercase 'sha1' algorithm name", async () => {
    const key = new TextEncoder().encode("a-test-key-of-some-length");
    const message = new TextEncoder().encode("message");
    const digest = await hmac("sha1", key, message);
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(digest.length).toBe(20); // SHA-1 digest length
  });

  it("computes real digests for sha256/sha512 too, not just sha1", async () => {
    const key = new TextEncoder().encode("a-test-key-of-some-length");
    const message = new TextEncoder().encode("message");
    expect((await hmac("sha256", key, message)).length).toBe(32);
    expect((await hmac("sha512", key, message)).length).toBe(64);
  });

  it("generates a real, verifiable TOTP code end-to-end via otp-io", async () => {
    const secret = generateKey(randomBytes, 20);
    const code = await totp(hmac, { secret });
    expect(code).toMatch(/^\d{6}$/);
  });
});
