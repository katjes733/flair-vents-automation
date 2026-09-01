import { describe, it, expect } from "vitest";
import { maskEmail } from "~/server/util/maskEmail";

describe("maskEmail", () => {
  it("keeps the domain, masks the local part", () => {
    expect(maskEmail("someone@example.com")).toBe("****@example.com");
  });

  it("masks entirely when there's no @ or it's the first character", () => {
    expect(maskEmail("not-an-email")).toBe("****");
    expect(maskEmail("@example.com")).toBe("****");
  });
});
