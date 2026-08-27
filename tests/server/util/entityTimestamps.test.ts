import { describe, it, expect } from "vitest";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";

describe("entityTimestamps", () => {
  it("stamps a fresh id and matching creation_time/modified_time", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const row = withTimestamps({ name: "Upstairs" }, now);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.creation_time).toBe(now);
    expect(row.modified_time).toBe(now);
    expect(row.name).toBe("Upstairs");
  });

  it("generates a different id on each call", () => {
    const a = withTimestamps({});
    const b = withTimestamps({});
    expect(a.id).not.toBe(b.id);
  });

  it("touch() bumps only modified_time", () => {
    const now = new Date("2026-01-02T00:00:00.000Z");
    expect(touch(now)).toEqual({ modified_time: now });
  });
});
