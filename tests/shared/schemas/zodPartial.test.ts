import { describe, it, expect } from "vitest";
import { z } from "zod";
import { genuinePartial } from "~/shared/schemas/zodPartial";

const sampleSchema = z.object({
  withDefault: z.number().default(42),
  alsoWithDefault: z.array(z.string()).default([]),
  noDefault: z.string().optional(),
});

describe("genuinePartial", () => {
  it("leaves every omitted field genuinely absent, not defaulted", () => {
    const partial = genuinePartial(sampleSchema);
    expect(partial.parse({ withDefault: 7 })).toEqual({ withDefault: 7 });
  });

  it("still validates a fully-specified object the same as the source schema", () => {
    const partial = genuinePartial(sampleSchema);
    const full = { withDefault: 1, alsoWithDefault: ["a"], noDefault: "x" };
    expect(partial.parse(full)).toEqual(full);
  });

  it("still enforces each field's own validation rules when present", () => {
    const strictSchema = z.object({ bounded: z.number().max(10).default(5) });
    const partial = genuinePartial(strictSchema);
    expect(() => partial.parse({ bounded: 100 })).toThrow();
  });

  it("parses an empty object to a genuinely empty object, not a defaulted one", () => {
    const partial = genuinePartial(sampleSchema);
    expect(partial.parse({})).toEqual({});
  });
});
