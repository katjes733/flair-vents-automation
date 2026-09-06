import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getWebauthnConfig } from "~/server/util/requestOrigin";

describe("getWebauthnConfig", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_EXPECTED_ORIGINS;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("rejects an IP-address rpID", () => {
    process.env.WEBAUTHN_RP_ID = "192.168.2.108";
    process.env.WEBAUTHN_EXPECTED_ORIGINS = "https://192.168.2.108";
    expect(() => getWebauthnConfig()).toThrow(/registrable domain/i);
  });

  it("defaults to localhost/https://localhost:5173 in development", () => {
    process.env.NODE_ENV = "development";
    expect(getWebauthnConfig()).toEqual({
      rpID: "localhost",
      expectedOrigin: ["https://localhost:5173"],
    });
  });

  it("throws in production when WEBAUTHN_RP_ID is unset", () => {
    process.env.NODE_ENV = "production";
    expect(() => getWebauthnConfig()).toThrow(/WEBAUTHN_RP_ID/);
  });

  it("throws in production when WEBAUTHN_EXPECTED_ORIGINS is unset", () => {
    process.env.NODE_ENV = "production";
    process.env.WEBAUTHN_RP_ID = "flair.katjes733.com";
    expect(() => getWebauthnConfig()).toThrow(/WEBAUTHN_EXPECTED_ORIGINS/);
  });

  it("reads a real domain and multiple expected origins from env", () => {
    process.env.NODE_ENV = "production";
    process.env.WEBAUTHN_RP_ID = "flair.katjes733.com";
    process.env.WEBAUTHN_EXPECTED_ORIGINS =
      "https://flair.katjes733.com, https://flair-staging.katjes733.com";
    expect(getWebauthnConfig()).toEqual({
      rpID: "flair.katjes733.com",
      expectedOrigin: [
        "https://flair.katjes733.com",
        "https://flair-staging.katjes733.com",
      ],
    });
  });
});
