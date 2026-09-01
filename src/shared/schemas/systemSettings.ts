import { z } from "zod";

// Every default below is either (a) stated explicitly in the implementation
// plan (cited in the comment) or (b) a placeholder I picked because the plan
// deliberately left it open pending Domain Research / kickoff confirmation —
// those are marked "PLACEHOLDER" so they're easy to grep for and revisit.
// Nothing here is a topology pressure limit — those ship with no default at
// all until the Domain Research Directive lands (see pressure/topologyLimits.ts).

export const modifierBoostsSchema = z.object({
  // Stated default: "modifierBoosts.occupancy defaults to 0.3" (Occupancy
  // section). The other three boosts have no stated numeric default in the
  // plan — defaulted to the same modest 0.3 for consistency. PLACEHOLDER.
  occupancy: z.number().min(0).default(0.3),
  spike: z.number().min(0).default(0.3),
  high_internal_heat_load: z.number().min(0).default(0.3),
  distant_high_duct_loss: z.number().min(0).default(0.3),
});

export const systemSettingsConfigSchema = z.object({
  // --- Step 1 / position math ---
  // 3°F → 1.67°C (Temperature units / Step 1 sections).
  proportional_band_width: z.number().positive().default(1.67),
  max_position_pct: z.number().min(0).max(100).default(100),
  modifier_boosts: modifierBoostsSchema.default(modifierBoostsSchema.parse({})),
  // Stated as a configurable 15%-25% range, not one hardcoded number — 20%
  // picked as the midpoint (Step 1 section).
  heating_choke_position_pct: z.number().min(15).max(25).default(20),

  // --- Step 2 / ramp & dispatch ---
  // The spec's own stated defaults, kept despite the deadlock they'd create
  // together — validateConfig warns, it doesn't reject (Resolved Design
  // Decisions).
  modulation_step_pct: z.number().positive().default(10),
  max_steps_per_tick: z.number().int().positive().default(1),
  min_step_delta_pct: z.number().positive().default(15),
  // Quiet actuation: while a zone's currently-active schedule event has
  // Sleep Mode (assume_occupied) set for it, this threshold replaces
  // min_step_delta_pct at the dispatch decision only — small deviations
  // accumulate silently until they cross this wider bar, so a bedroom
  // vent moves less often but further each time, rather than motor-cycling
  // repeatedly overnight. Never widens reconciliation's own tolerance for
  // whether a dispatched command actually landed — that stays comfort/
  // correctness-focused regardless of the hour. PLACEHOLDER pending
  // real-world tuning; must stay >= min_step_delta_pct to have any effect.
  sleep_mode_min_step_delta_pct: z.number().positive().max(100).default(30),
  // Backstop drift check, compares reported vs. last_target_position every
  // Nth tick (Resolved Design Decisions).
  drift_check_interval_ticks: z.number().int().positive().default(10),

  // --- Step 3 / contention ---
  // "spiking → occupied → unoccupied" is the literal spec behavior; a flip
  // to a flat priority-only model is a config switch, not a rewrite (Step 3 /
  // Resolved Design Decisions).
  bucket_mode: z
    .enum(["bucket_major", "priority_only"])
    .default("bucket_major"),
  zone_priority_order: z.array(z.uuid()).default([]),

  // --- Pressure safeguard ---
  // "a standard-duct-diameter-implied value" — no specific figure stated in
  // the plan. ~100 CFM. PLACEHOLDER.
  default_zone_flow_rate_lps: z.number().positive().default(47),

  // --- Occupancy ---
  // Stated default (Occupancy section: "During FAN_ONLY/IDLE only, the
  // gentler settings.unoccupiedIdleFactor (default 0.5)").
  unoccupied_idle_factor: z.number().min(0).max(1).default(0.5),
  // Stabilization dwell before flipping the debounced occupancy state,
  // mirroring spike detection's hysteresis shape — shorter than spike's
  // default (5 min), since "someone walked into the room" shouldn't lag as
  // much, but still needs some debounce against a flickering raw signal.
  // PLACEHOLDER pending real-world tuning.
  occupancy_stabilization_minutes: z.number().positive().default(2),

  // --- Dynamic thermal spike detection ---
  // Window stated as a 10-15 minute range; 12 picked as a representative
  // point in it. Threshold/hysteresis/plausibility-cap figures aren't given
  // specific numbers in the plan. All PLACEHOLDER pending real-world tuning.
  spike_window_minutes: z.number().positive().default(12),
  spike_rate_threshold_c_per_min: z.number().positive().default(0.5),
  spike_clear_rate_threshold_c_per_min: z.number().positive().default(0.2),
  spike_stabilization_minutes: z.number().positive().default(5),
  spike_min_samples: z.number().int().positive().default(3),
  spike_min_span_minutes: z.number().positive().default(3),
  spike_plausibility_cap_c_per_min: z.number().positive().default(3),

  // --- Stale sensor reading safeguard ---
  // Stated default (Stale sensor reading safeguard section: "Default
  // staleness threshold: 15 minutes").
  stale_threshold_minutes: z.number().positive().default(15),

  // --- Driving setpoint / Ecobee mechanism ---
  // Hysteresis margin/dwell are stated defaults (Driving setpoint selection
  // section: "a configurable margin (default 0.3°C)... a configurable dwell
  // (default 2 ticks)").
  drive_zone_switch_margin_c: z.number().positive().default(0.3),
  drive_zone_switch_dwell_ticks: z.number().int().positive().default(2),
  // "default assumption 0.5°C pending [Phase 0] confirmation" (Driving
  // setpoint selection section).
  setpoint_push_rounding_c: z.number().positive().default(0.5),
  // Offset clamp/smoothing/termination margin have no stated figures in the
  // plan. All PLACEHOLDER.
  offset_max_c: z.number().positive().default(5.56),
  offset_smoothing_alpha: z.number().min(0).max(1).default(0.3),
  termination_margin_c: z.number().positive().default(0.3),

  // --- Away Mode ---
  // The pair is stated as required ("not a single value"); no specific
  // numeric setpoints are stated in the plan. PLACEHOLDER (eco-ish
  // defaults: ~82°F cool, ~60°F heat).
  away_setpoint_cool: z.number().default(27.78),
  away_setpoint_heat: z.number().default(15.56),
  // ±5°F → ±2.78°C (Away Mode section).
  away_tolerance: z.number().positive().default(2.78),
  away_native_zone_ids: z.array(z.string().uuid()).default([]),

  // --- Shadow mode / manual disarm ---
  live_air_handler_ids: z.array(z.string().uuid()).default([]),
  control_disarmed: z.boolean().default(false),
  driving_zone_overrides: z
    .record(z.string().uuid(), z.string().uuid())
    .default({}),

  // --- Sensor disagreement ---
  // "the configurable divergence threshold" — dormant until a room has more
  // than one sensor; no figure stated. PLACEHOLDER (~1°F).
  sensor_disagreement_threshold_c: z.number().positive().default(0.56),

  // --- Control loop ---
  control_tick_interval_seconds: z.number().positive().default(60),
  tick_watchdog_seconds: z.number().positive().default(45),
  reconciliation_retry_count: z.number().int().positive().default(3),

  // --- Emergency fail-safe (duct-temperature differential — see the plan's
  // Emergency fail-safe section for why this is derived rather than read
  // directly from a Flair-provided fault field, which doesn't exist).
  // No figures stated in the plan pending real-world tuning. PLACEHOLDER.
  equipment_fault_grace_period_minutes: z.number().positive().default(10),
  equipment_fault_duct_delta_threshold_c: z.number().positive().default(5.56),
  equipment_fault_clear_dwell_minutes: z.number().positive().default(5),
  // Alert-only backstop, never a fail-safe trigger — see the plan.
  hvac_no_improvement_alert_minutes: z.number().positive().default(75),
  // Isolated per-zone duct-airflow anomaly (this vent fails the duct-temp
  // differential while a sibling passes) — reuses
  // equipment_fault_duct_delta_threshold_c for the threshold itself, but
  // needs a longer sustained-duration before alerting since this is
  // diagnostic, not protective, and benefits from more confidence.
  duct_anomaly_alert_minutes: z.number().positive().default(20),

  // --- Comfort / deadband ---
  // 2°F → 1.11°C (Config-time validation section).
  heat_cool_deadband_min_c: z.number().positive().default(1.11),

  // --- Fallback baselines ---
  // No specific figures stated in the plan. PLACEHOLDER (~75°F / ~70°F).
  fallback_setpoint_cool: z.number().default(23.89),
  fallback_setpoint_heat: z.number().default(21.11),

  // --- Alerting ---
  // "default 70%, i.e. 35 of 50" (Token persistence section).
  token_budget_alert_threshold_pct: z.number().min(0).max(100).default(70),
  // In-process rate floor on notifyOnce (Email alerting section: "~15 min").
  email_rate_floor_minutes: z.number().positive().default(15),
  // "default every 24h" (Manual disarm section).
  disarm_reminder_interval_hours: z.number().positive().default(24),
  // No specific figure stated for vent-degraded alert duration. PLACEHOLDER.
  vent_degraded_alert_minutes: z.number().positive().default(30),

  // --- Time / display ---
  // Bootstrap-seed only — see Environment & Dev Modes; this row is what's
  // actually authoritative after first boot.
  home_timezone: z.string().default("America/Phoenix"),
  display_temperature_unit: z.enum(["C", "F"]).default("F"),
});

export type SystemSettingsConfig = z.infer<typeof systemSettingsConfigSchema>;

export function resolveSystemSettings(stored: unknown): SystemSettingsConfig {
  return systemSettingsConfigSchema.parse(stored ?? {});
}
