import { describe, it, expect } from "vitest";
import { manualOverrideConfigSchema } from "~/shared/schemas/manualOverride";

describe("manualOverrideConfigSchema", () => {
  it("accepts a setpoint override with an unbounded numeric value", () => {
    const parsed = manualOverrideConfigSchema.parse({
      kind: "setpoint",
      value: 21.5,
      hold_type: "2h",
      actor: "Martin",
    });
    expect(parsed.kind).toBe("setpoint");
  });

  it("accepts a position override bounded to [0,100]", () => {
    expect(() =>
      manualOverrideConfigSchema.parse({
        kind: "position",
        value: 50,
        hold_type: "permanent",
        actor: "Martin",
      }),
    ).not.toThrow();
  });

  it("rejects a position override value outside [0,100]", () => {
    expect(() =>
      manualOverrideConfigSchema.parse({
        kind: "position",
        value: 150,
        hold_type: "permanent",
        actor: "Martin",
      }),
    ).toThrow();
  });

  it("requires a non-empty actor", () => {
    expect(() =>
      manualOverrideConfigSchema.parse({
        kind: "setpoint",
        value: 21,
        hold_type: "4h",
        actor: "",
      }),
    ).toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() =>
      manualOverrideConfigSchema.parse({
        kind: "unknown",
        value: 21,
        hold_type: "4h",
        actor: "Martin",
      }),
    ).toThrow();
  });
});
