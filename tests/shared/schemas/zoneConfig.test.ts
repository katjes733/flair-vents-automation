import { describe, it, expect } from "vitest";
import {
  resolveZoneConfig,
  zoneConfigPartialSchema,
  COMFORT_TOLERANCE_MAX_C,
  DUCT_FLOW_RATE_MAX_LPS,
} from "~/shared/schemas/zoneConfig";

describe("resolveZoneConfig", () => {
  it("applies every stated default against an empty config", () => {
    const config = resolveZoneConfig({});
    expect(config.idle_baseline_position).toBe(100);
    expect(config.sensor_calibration_offset).toBe(0);
    expect(config.min_vent_position).toBe(0);
    expect(config.max_vent_position).toBe(100);
    expect(config.thermal_load_flags).toEqual([]);
    expect(config.has_temperature_sensor).toBe(false);
    expect(config.has_occupancy_sensor).toBe(false);
    expect(config.manual_vents).toEqual([]);
    expect(config.flair_vents).toEqual([]);
  });

  it("leaves comfort_tolerance unset rather than defaulting it to 0", () => {
    const config = resolveZoneConfig({});
    expect(config.comfort_tolerance).toBeUndefined();
  });

  it("resolves against null the same as against an empty object", () => {
    expect(resolveZoneConfig(null)).toEqual(resolveZoneConfig({}));
  });

  it("rejects a comfort_tolerance above the 10°F sanity bound", () => {
    expect(() =>
      resolveZoneConfig({ comfort_tolerance: COMFORT_TOLERANCE_MAX_C + 0.01 }),
    ).toThrow();
  });

  // The old zone-level duct_flow_rate_lps field is retired (see
  // "Multi-Vent Manual Zones") — the sanity bound now applies per vent,
  // on both manual_vents and flair_vents.
  it("rejects a manual vent's duct_flow_rate_lps above the ~2000 CFM sanity bound", () => {
    expect(() =>
      resolveZoneConfig({
        manual_vents: [
          { position: 50, duct_flow_rate_lps: DUCT_FLOW_RATE_MAX_LPS + 1 },
        ],
      }),
    ).toThrow();
  });

  it("rejects a flair vent's duct_flow_rate_lps above the ~2000 CFM sanity bound", () => {
    expect(() =>
      resolveZoneConfig({
        flair_vents: [
          {
            flair_vent_id: "vent-1",
            duct_flow_rate_lps: DUCT_FLOW_RATE_MAX_LPS + 1,
          },
        ],
      }),
    ).toThrow();
  });

  // Regression coverage for "Multi-Vent Manual Zones" extending per-vent
  // duct ratings from manual vents to flair_smart_vent zones: each flair
  // vent carries its own identity and (optional) duct rating.
  it("accepts a flair_vents array with per-vent id and duct rating", () => {
    const config = resolveZoneConfig({
      flair_vents: [
        { flair_vent_id: "vent-1", duct_flow_rate_lps: 94.4 },
        { flair_vent_id: "vent-2" },
      ],
    });
    expect(config.flair_vents).toEqual([
      { flair_vent_id: "vent-1", duct_flow_rate_lps: 94.4 },
      { flair_vent_id: "vent-2" },
    ]);
  });

  // Regression coverage for "Multi-Vent Manual Zones": each manual vent
  // carries its own position and (optional) duct rating.
  it("accepts a manual_vents array with per-vent position and duct rating", () => {
    const config = resolveZoneConfig({
      manual_vents: [
        { position: 75, duct_flow_rate_lps: 40 },
        { position: 25 },
      ],
    });
    expect(config.manual_vents).toEqual([
      { position: 75, duct_flow_rate_lps: 40 },
      { position: 25 },
    ]);
  });

  it("rejects a manual vent position outside 0-100", () => {
    expect(() =>
      resolveZoneConfig({ manual_vents: [{ position: 101 }] }),
    ).toThrow();
  });

  it("accepts both thermal load flags set simultaneously", () => {
    const config = resolveZoneConfig({
      thermal_load_flags: ["high_internal_heat_load", "distant_high_duct_loss"],
    });
    expect(config.thermal_load_flags).toEqual([
      "high_internal_heat_load",
      "distant_high_duct_loss",
    ]);
  });
});

describe("zoneConfigPartialSchema", () => {
  // Regression test: `zoneConfigSchema.partial()` alone does NOT produce a
  // true partial — Zod still substitutes each field's own `.default()`
  // for an omitted key even once `.partial()` wraps it `.optional()`.
  // Confirmed live: a zone-card reorder patching only `display_order`
  // reintroduced every other field at its default (including
  // `flair_vent_ids: []`), which then wiped a real multi-vent zone's
  // vent ids once merged onto the existing row in zoneService.ts — the
  // PATCH failed with "requires at least one flair_vent_id" for a zone
  // that genuinely had vents. `zoneConfigPartialSchema` (defaults
  // stripped before partializing) is the fix; this test is what would
  // have caught it directly.
  it("leaves every omitted field genuinely absent, not defaulted", () => {
    const result = zoneConfigPartialSchema.parse({ display_order: 1 });
    expect(result).toEqual({ display_order: 1 });
  });

  it("still validates a fully-specified config the same as the full schema", () => {
    const full = {
      has_temperature_sensor: true,
      has_occupancy_sensor: false,
      thermal_load_flags: [],
      idle_baseline_position: 80,
      sensor_calibration_offset: 0,
      min_vent_position: 0,
      max_vent_position: 100,
      manual_vents: [],
      flair_vents: [{ flair_vent_id: "vent-1" }],
      display_order: 2,
    };
    expect(zoneConfigPartialSchema.parse(full)).toEqual(full);
  });

  it("still rejects an out-of-bounds value for a field that is present", () => {
    expect(() =>
      zoneConfigPartialSchema.parse({
        comfort_tolerance: COMFORT_TOLERANCE_MAX_C + 0.01,
      }),
    ).toThrow();
  });

  // The zone-level duct_flow_rate_lps field this null-sentinel test was
  // originally written against (and, before that, assumed_fixed_position)
  // is retired entirely — see "Multi-Vent Manual Zones": both
  // manual_fixed_vent and flair_smart_vent zones now carry their rating
  // per vent, and no field on this schema currently needs null-sentinel
  // clearing. The general mechanism itself (an explicit `null` normalizing
  // to an explicit `undefined` property, not an omitted key) stays covered
  // schema-agnostically in zodPartial.test.ts — this is a deliberate
  // removal, not a gap, and a new case belongs here again the day a real
  // field needs it.
});
