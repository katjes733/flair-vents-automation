import { describe, it, expect } from "vitest";
import { formatPct } from "~/client/util/formatPct";

describe("formatPct", () => {
  it("rounds a raw float to a whole number", () => {
    expect(formatPct(29.123580267841994)).toBe("29");
  });

  it("rounds up at the midpoint", () => {
    expect(formatPct(29.5)).toBe("30");
  });

  it("renders a whole number unchanged", () => {
    expect(formatPct(100)).toBe("100");
  });

  it("renders the placeholder for null", () => {
    expect(formatPct(null)).toBe("—");
  });

  it("renders the placeholder for undefined", () => {
    expect(formatPct(undefined)).toBe("—");
  });
});
