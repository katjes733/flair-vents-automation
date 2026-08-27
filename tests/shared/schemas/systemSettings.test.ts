import { describe, it, expect } from "vitest";
import { resolveSystemSettings } from "~/shared/schemas/systemSettings";

describe("resolveSystemSettings", () => {
  it("resolves every field with a default against an empty config, with zero backfill", () => {
    const settings = resolveSystemSettings({});
    // Spot-check the values explicitly stated in the implementation plan —
    // not every field, since most are documented placeholders.
    expect(settings.proportional_band_width).toBeCloseTo(1.67);
    expect(settings.max_position_pct).toBe(100);
    expect(settings.modifier_boosts.occupancy).toBeCloseTo(0.3);
    expect(settings.modulation_step_pct).toBe(10);
    expect(settings.max_steps_per_tick).toBe(1);
    expect(settings.min_step_delta_pct).toBe(15);
    expect(settings.unoccupied_idle_factor).toBe(0.5);
    expect(settings.stale_threshold_minutes).toBe(15);
    expect(settings.drive_zone_switch_margin_c).toBeCloseTo(0.3);
    expect(settings.drive_zone_switch_dwell_ticks).toBe(2);
    expect(settings.setpoint_push_rounding_c).toBeCloseTo(0.5);
    expect(settings.away_tolerance).toBeCloseTo(2.78);
    expect(settings.heat_cool_deadband_min_c).toBeCloseTo(1.11);
    expect(settings.token_budget_alert_threshold_pct).toBe(70);
    expect(settings.disarm_reminder_interval_hours).toBe(24);
    expect(settings.control_tick_interval_seconds).toBe(60);
    expect(settings.control_disarmed).toBe(false);
    expect(settings.live_air_handler_ids).toEqual([]);
    expect(settings.away_native_zone_ids).toEqual([]);
    expect(settings.home_timezone).toBe("America/Phoenix");
    expect(settings.display_temperature_unit).toBe("F");
  });

  it("resolves against null the same as against an empty object", () => {
    expect(resolveSystemSettings(null)).toEqual(resolveSystemSettings({}));
  });

  it("a partial stored config only overrides what it specifies", () => {
    const settings = resolveSystemSettings({
      control_disarmed: true,
      home_timezone: "America/Denver",
    });
    expect(settings.control_disarmed).toBe(true);
    expect(settings.home_timezone).toBe("America/Denver");
    // Untouched fields still resolve to their own defaults.
    expect(settings.max_position_pct).toBe(100);
  });

  it("rejects an out-of-range token budget alert threshold", () => {
    expect(() =>
      resolveSystemSettings({ token_budget_alert_threshold_pct: 150 }),
    ).toThrow();
  });
});
