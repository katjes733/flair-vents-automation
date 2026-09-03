import { describe, it, expect } from "vitest";
import { renderOAuthCallbackPage } from "~/server/util/oauthCallbackPage";

describe("renderOAuthCallbackPage", () => {
  it("renders a success page that posts a success message and schedules a close", () => {
    const html = renderOAuthCallbackPage({ success: true, nonce: "abc123" });
    expect(html).toContain("Authorization Successful");
    expect(html).toContain('status: "success"');
    expect(html).toContain("flair-oauth");
    expect(html).toContain('nonce="abc123"');
  });

  it("renders a known error code's specific message", () => {
    const html = renderOAuthCallbackPage({
      success: false,
      code: "invalid_state",
      nonce: "n",
    });
    expect(html).toContain("Authorization Failed");
    expect(html).toContain("no longer valid");
  });

  it("falls back to a generic message for an unrecognized error code", () => {
    const html = renderOAuthCallbackPage({
      success: false,
      code: "something_new",
      nonce: "n",
    });
    expect(html).toContain("Something went wrong during authorization.");
  });

  it("embeds the given nonce so the CSP header and the script tag match", () => {
    const html = renderOAuthCallbackPage({
      success: true,
      nonce: "unique-nonce-value",
    });
    expect(html).toContain('script nonce="unique-nonce-value"');
  });
});
