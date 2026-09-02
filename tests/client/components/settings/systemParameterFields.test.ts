import { describe, it, expect } from "vitest";
import {
  SYSTEM_SETTINGS_DEFAULTS,
  SYSTEM_PARAMETER_GROUPS,
  getByPath,
  setByPath,
  paramUnitLabel,
  toDisplayString,
  fromDisplayString,
  sameDisplayValue,
  type DisplayUnits,
} from "~/client/components/settings/systemParameterFields";

const F: DisplayUnits = { temperatureUnit: "F", airflowUnit: "CFM" };
const C: DisplayUnits = { temperatureUnit: "C", airflowUnit: "Lps" };

describe("getByPath / setByPath", () => {
  it("gets and sets a flat key", () => {
    expect(getByPath({ a: 1 }, "a")).toBe(1);
    expect(setByPath({ a: 1 }, "a", 2)).toEqual({ a: 2 });
  });

  it("gets and sets a nested key without mutating the original", () => {
    const original = { modifier_boosts: { occupancy: 0.3, spike: 0.3 } };
    expect(getByPath(original, "modifier_boosts.occupancy")).toBe(0.3);
    const updated = setByPath(original, "modifier_boosts.occupancy", 0.5);
    expect(updated.modifier_boosts.occupancy).toBe(0.5);
    expect(updated.modifier_boosts.spike).toBe(0.3);
    expect(original.modifier_boosts.occupancy).toBe(0.3);
  });

  it("getByPath returns undefined for a missing path rather than throwing", () => {
    expect(getByPath({ a: 1 }, "b.c")).toBeUndefined();
    expect(getByPath(null, "a")).toBeUndefined();
  });
});

describe("SYSTEM_SETTINGS_DEFAULTS", () => {
  it("is the real, schema-resolved defaults, not a hand-duplicated list", () => {
    expect(SYSTEM_SETTINGS_DEFAULTS.control_tick_interval_seconds).toBe(60);
    expect(SYSTEM_SETTINGS_DEFAULTS.proportional_band_width).toBeCloseTo(1.67);
    expect(SYSTEM_SETTINGS_DEFAULTS.modifier_boosts.occupancy).toBeCloseTo(0.3);
    expect(SYSTEM_SETTINGS_DEFAULTS.bucket_mode).toBe("bucket_major");
  });

  it("every field named in SYSTEM_PARAMETER_GROUPS actually resolves on the real defaults", () => {
    for (const group of SYSTEM_PARAMETER_GROUPS) {
      for (const field of group.fields) {
        expect(
          getByPath(SYSTEM_SETTINGS_DEFAULTS, field.path),
        ).not.toBeUndefined();
      }
    }
  });
});

describe("paramUnitLabel", () => {
  it("reflects the active temperature/airflow unit for unit-dependent kinds", () => {
    expect(paramUnitLabel("tempAbsolute", F)).toBe("°F");
    expect(paramUnitLabel("tempAbsolute", C)).toBe("°C");
    expect(paramUnitLabel("tempRatePerMin", F)).toBe("°F/min");
    expect(paramUnitLabel("airflow", F)).toBe("CFM");
    expect(paramUnitLabel("airflow", C)).toBe("L/s");
  });

  it("is fixed for unit-independent kinds", () => {
    expect(paramUnitLabel("percent", F)).toBe("%");
    expect(paramUnitLabel("minutes", F)).toBe("min");
    expect(paramUnitLabel("seconds", F)).toBe("s");
    expect(paramUnitLabel("hours", F)).toBe("h");
    expect(paramUnitLabel("int", F)).toBe("");
    expect(paramUnitLabel("text", F)).toBe("");
  });
});

describe("toDisplayString / fromDisplayString", () => {
  it("converts an absolute temperature through the active unit and back", () => {
    // 27.78°C (a real stored default, away_setpoint_cool) ~= 82°F.
    expect(toDisplayString("tempAbsolute", 27.78, F)).toBe("82");
    expect(fromDisplayString("tempAbsolute", "82", F)).toBeCloseTo(27.78, 1);
    expect(toDisplayString("tempAbsolute", 27.78, C)).toBe("27.78");
  });

  it("converts a temperature delta with scale only, no +32 offset", () => {
    // 1.67°C band width -> ~3.01°F, NOT ~34°F (which the absolute formula
    // would wrongly produce) — the exact bug the two distinct kinds guard against.
    expect(toDisplayString("tempDelta", 1.67, F)).toBe("3.01");
    expect(fromDisplayString("tempDelta", "3.01", F)).toBeCloseTo(1.67, 1);
  });

  it("converts a rate (per-minute delta) with the same scale-only rule", () => {
    expect(toDisplayString("tempRatePerMin", 0.5, F)).toBe("0.9");
  });

  it("converts airflow through the active unit", () => {
    // 47 L/s (default_zone_flow_rate_lps) ~= 99.59 CFM.
    expect(toDisplayString("airflow", 47, F)).toBe("99.59");
    expect(toDisplayString("airflow", 47, C)).toBe("47");
  });

  it("passes plain numeric kinds through unconverted", () => {
    expect(toDisplayString("percent", 60, F)).toBe("60");
    expect(toDisplayString("minutes", 15, F)).toBe("15");
    expect(fromDisplayString("int", "3", F)).toBe(3);
  });

  it("passes text/enum through as plain strings, never numeric-converted", () => {
    expect(toDisplayString("text", "America/Denver", F)).toBe("America/Denver");
    expect(fromDisplayString("enum", "bucket_major", F)).toBe("bucket_major");
  });

  it("returns an empty display string for a missing/non-finite stored value", () => {
    expect(toDisplayString("percent", undefined, F)).toBe("");
    expect(toDisplayString("percent", "not-a-number", F)).toBe("");
  });

  it("fromDisplayString surfaces NaN for invalid numeric input, not a silent 0", () => {
    expect(fromDisplayString("percent", "not-a-number", F)).toBeNaN();
  });
});

describe("sameDisplayValue", () => {
  it("compares two already-rounded display strings, not canonical round-trips", () => {
    // The same stored value, converted to a display string the same way
    // twice, is trivially equal — no round-trip through the inverse
    // conversion is involved.
    const displayed = toDisplayString("tempDelta", 1.67, F);
    expect(sameDisplayValue("tempDelta", displayed, displayed)).toBe(true);
  });

  it("catches a real display-space difference a canonical-space compare would miss on drift", () => {
    // A conversion + round + inverse conversion does not round-trip
    // exactly (1.67°C -> 3.01°F -> ~1.6722°C) — this is exactly why the
    // page compares in display space rather than canonical space; here,
    // two genuinely different display strings are correctly unequal.
    expect(sameDisplayValue("tempDelta", "3.01", "3.02")).toBe(false);
  });

  it("treats a real difference as not equal", () => {
    expect(sameDisplayValue("percent", "60", "70")).toBe(false);
  });

  it("compares text/enum by exact string equality", () => {
    expect(sameDisplayValue("enum", "bucket_major", "bucket_major")).toBe(true);
    expect(sameDisplayValue("enum", "bucket_major", "priority_only")).toBe(
      false,
    );
  });

  it("is false when either side is non-numeric for a numeric kind", () => {
    expect(sameDisplayValue("percent", "not-a-number", "60")).toBe(false);
  });
});
