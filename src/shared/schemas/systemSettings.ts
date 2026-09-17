import { z } from "zod";
import { genuinePartial } from "~/shared/schemas/zodPartial";

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
  // System-wide fallback for a flair_smart_vent zone's own
  // idle_baseline_position (zoneConfig.ts), used whenever a zone leaves it
  // unset. Defaulted to 0, not the old flat 100 every zone used to get —
  // a real, confirmed incident (docs/recommendation-engine-candidates.md):
  // a zone sitting at its 100%-default idle baseline while merely
  // satisfied (not overshooting enough to trigger the closing ramp) ran
  // the "Upstairs" air handler at 190%+ of rated blower capacity, all
  // day, for no comfort benefit — closing a satisfied zone by default
  // costs nothing (real production data: zero insufficient-capacity
  // ticks across 2.5 days even with three zones idling at a much lower
  // baseline), since capacity-sharing independently guarantees a
  // genuinely struggling zone gets reopened regardless of what this
  // default is.
  comfort_idle_baseline_position: z.number().min(0).max(100).default(0),
  // The equivalent fallback for FAN_ONLY specifically — deliberately a
  // separate setting from comfort_idle_baseline_position above, not the
  // same value reused. FAN_ONLY's whole purpose is circulating air
  // throughout the structure while nothing is being conditioned, so a
  // "satisfied, keep it mostly closed" default makes no sense here — a
  // closed vent during FAN_ONLY doesn't save anything (there's no
  // conditioned air to conserve), it just fails to circulate that room.
  // Defaulted to 100, the opposite of the comfort-case default.
  fan_only_idle_baseline_position: z.number().min(0).max(100).default(100),

  // --- Step 2 / ramp & dispatch ---
  // The spec's own stated defaults, kept despite the deadlock they'd create
  // together — validateConfig warns, it doesn't reject (Resolved Design
  // Decisions).
  modulation_step_pct: z.number().positive().default(10),
  // Opt-in "discrete positions" experiment (default null = off, today's
  // fine-grained behavior unchanged). Flair's own `percent-open` is
  // documented as an accumulated motor estimate, not a true position
  // sensor — the only two positions with a real hard-stop physical
  // reference are 0% and 100%; every intermediate value is an unverified
  // estimate that can only drift further from reality with each
  // subsequent move (confirmed live: Martin Office commanded/confirmed at
  // 20% while physically closer to 80% open). Flair's own app reportedly
  // never offers anything but fully open/closed for exactly this reason.
  // When set, this REPLACES modulation_step_pct as the effective grid for
  // every finally-committed smart-vent position — both the demanding
  // branch's own floor (step1DesiredPosition.ts) and Step 2's ramp/
  // quantize (step2Ramp.ts) — and also as the ramp-rate limit itself, so
  // a zone commits directly to its next trusted position in one tick
  // rather than crawling through now-untrusted intermediate values before
  // snapping. Also closes a real gap this change surfaced: the pressure/
  // aggregate-flow safeguard's own reopen calculation
  // (pressureSafeguard.ts) previously computed an unquantized float
  // always, regardless of this setting — now rounds *up* (never to
  // nearest, which could under-shoot the very floor it exists to
  // satisfy) to the nearest multiple of the effective step, but ONLY
  // while this setting is active. Deliberately not extended to the
  // plain-modulation_step_pct case even though the same off-grid gap
  // exists there too: a tiny, functionally-negligible reopen (a fraction
  // of a percent, e.g. from a near-zero configured floor) is harmless as
  // an unquantized float on the fine 10%-step grid — confirmed live, this
  // exact change broke a real vent-misalignment test by turning a
  // dust-sized 0.002%-open nudge into a disruptive full 10%-open jump
  // before being scoped down to bucketing-only. 100 = binary (0/100
  // only, mirroring Flair's own app); 50 = 0/50/100; 25 = 0/25/50/75/100.
  // Does not affect manual position overrides, manual_fixed_vent, or
  // no_vent zones — none of those have a software-estimated position to
  // distrust.
  discrete_position_step_pct: z
    .union([z.literal(25), z.literal(50), z.literal(100)])
    .nullable()
    .default(null),
  max_steps_per_tick: z.number().int().positive().default(1),
  // Dead-zone recovery: Flair's own vent motors have been observed, on
  // real hardware, to sit fully unresponsive to ordinary
  // modulation_step_pct-sized commands for a stretch when first starting
  // to move away from a hard physical extreme (0%/100%) — confirmed in
  // both directions (opening from closed and closing from open), with no
  // consistent/predictable threshold from one occasion to the next (see
  // docs/adr). Rather than try to calibrate an exact deadzone width, a
  // zone leaving 0% or 100% jumps straight to this percentage once, then
  // resumes the normal step-capped ramp from there — even if that
  // overshoots or undershoots the real target, which the ordinary ramp
  // then corrects in whichever direction is actually needed. A per-zone
  // override (zoneConfigSchema's own `dead_zone_recovery_jump_pct`) takes
  // precedence when set. Null here (an explicitly cleared global setting,
  // distinct from the default) falls back to an ordinary max-size step
  // (modulation_step_pct * max_steps_per_tick, or discrete_position_step_pct
  // in its place) — functionally identical to not having this feature at
  // all.
  dead_zone_recovery_jump_pct: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .default(50),
  // Which direction(s) the jump above actually applies to — global only,
  // no per-zone override, unlike the jump percentage itself. Added after
  // real-world use surfaced a real asymmetry the original "always both
  // directions" design didn't anticipate: closing quickly from a
  // fully-open rest (backlash reversing the other way) has been observed
  // to occasionally carry a vent almost fully shut, well past the jump's
  // own landing value — a different, still-uncharacterized failure mode
  // from the opening side, which hasn't shown the same problem. Defaults
  // to "open" only, deliberately narrower than what first shipped, until
  // the closing side is better understood; "close" and "both" exist so
  // this can be tuned without a code change once it is.
  dead_zone_recovery_direction: z
    .enum(["open", "close", "both"])
    .default("open"),
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
  // Quiet anchor: a real, confirmed noise problem found live — even with
  // sleep_mode_min_step_delta_pct widened, a "satisfied" bedroom zone's
  // continuous overshoot ramp (step1DesiredPosition.ts) still walked
  // nearly its full position range every ~15 minutes all night, since sub-
  // degree sensor noise is enough to swing the ramp's output even though
  // the room never stopped being comfortable. While Sleep Mode is active
  // and a zone is satisfied, this freezes its position at whatever last
  // achieved comfort (captured on the demanding->satisfied transition, or
  // periodically per sleep_quiet_reanchor_interval_minutes) instead of
  // re-running the ramp every tick — a demanding zone is completely
  // unaffected, so a genuinely hot night still gets the full, immediate
  // ramp as a safety net. Defaults to off: this changes real overnight HVAC
  // behavior, so it ships opt-in rather than silently changing what every
  // existing installation does.
  sleep_quiet_anchor_enabled: z.boolean().default(false),
  // Only consulted while sleep_quiet_anchor_enabled is true. PLACEHOLDER
  // pending real-world tuning — long enough that a comfortable zone's
  // anchor is genuinely static for most of the night, short enough to
  // track real drift (compressor performance, outdoor temp) across it.
  sleep_quiet_reanchor_interval_minutes: z.number().positive().default(60),
  // Vent misalignment auto-recalibration: a real, confirmed live problem —
  // a flair_smart_vent zone reporting 0% (believed fully closed, and
  // classified "satisfied" — a genuinely demanding zone's own dispatch
  // gap is a separate, already-fixed problem) kept measurably cooling
  // during COOLING_CALL/warming during HEATING_CALL anyway, in lockstep
  // with the call's own on/off cycling — a sealed vent shouldn't care
  // whether the compressor is running. `percent-open` is an accumulated
  // motor estimate with known directional hysteresis (see
  // docs/flair-api-schema.md), not a true position sensor, so the vent's
  // real physical position had drifted open from its reported 0% with no
  // way to self-correct. Detection tracks per-zone temp response across a
  // single continuous COOLING_CALL/HEATING_CALL stretch while reported
  // position stays at 0% and the zone stays satisfied (see
  // ZoneRuntimeState.vent_misalignment_window_since/_start_temp) — reset
  // the instant any of those conditions breaks, since only response
  // *within one uninterrupted call segment* is diagnostic (an idle-segment
  // rebound is normal for every zone, sealed or not). Once flagged, the
  // corrective action is a full home cycle (command 100%, wait for it to
  // actually report there, then let the normal pipeline output — a huge
  // delta either way — carry it back down) rather than a diagnosis-only
  // alert: an occasional deliberate open/close cycle is a smaller cost
  // than a vent silently stuck open all night. Defaults to off — this
  // drives real vent hardware and overrides Sleep Mode's own quiet hours
  // when it fires, so it ships opt-in like every other feature that
  // changes real overnight behavior.
  vent_misalignment_auto_recalibration_enabled: z.boolean().default(false),
  // PLACEHOLDER pending real-world tuning — grounded in live tick history
  // for a real stuck vent: its zone measurably tracked each COOLING_CALL/
  // IDLE transition by ~1-1.5°C within a single 20-50 minute call segment,
  // well past ordinary sensor noise (~0.3-0.5°C observed elsewhere in this
  // codebase).
  vent_misalignment_temp_threshold_c: z.number().positive().default(0.56),
  // A real, confirmed gap found live: the original 4-24h cooldown here
  // meant a genuinely-leaking vent (not a stuck-estimate, one the fix
  // itself doesn't actually resolve — see recalibration's own "flip back
  // to target instead of a slow ramp" comment below) went completely
  // unmonitored between cycles, sometimes for most of a day, silently
  // overcooling the room the whole time. Renamed and shortened to a
  // debounce instead of a cooldown: now only long enough to let the
  // just-reclosed vent's own temperature reading settle before the
  // detection window can re-open, not a "stop watching" period — the
  // chronic-escalation settings below (not a long cooldown) are what
  // actually protects against cycling a persistently-faulty vent forever.
  // PLACEHOLDER pending real-world tuning.
  vent_misalignment_recalibration_debounce_minutes: z
    .number()
    .positive()
    .default(3),
  // Safety timeout on the "opening" half of the home cycle — if the vent
  // never reports itself open (a genuinely stuck/disconnected motor, not
  // just a misreporting one), this stops the cycle from holding the zone
  // fully open indefinitely; the debounce above still applies afterward.
  vent_misalignment_max_open_wait_minutes: z.number().positive().default(10),
  // Independent of the main feature flag — this is a common, expected,
  // self-correcting situation (see the feature's own comment above), so it
  // reports into the tick decision/telemetry like any other zone-level
  // flag but does not also warrant an email by default; flip this on only
  // if you want that email too. Chronic escalation (below) is deliberately
  // NOT gated behind this flag — a zone that keeps re-triggering despite
  // repeated "successful" recalibrations is a materially more serious
  // signal than a single occurrence, and always alerts regardless.
  vent_misalignment_alert_enabled: z.boolean().default(false),
  // Chronic escalation: every recorded recalibration outcome can read
  // "opened" (the vent visibly moves when commanded — proof the motor
  // works, not proof it actually seals) and the same zone still needs
  // another cycle a few hours later — real, confirmed live across three
  // zones on one air handler over 2.5 days, each recalibrating roughly
  // once every cooldown/debounce period, indefinitely. That repetition is
  // itself the signal: a vent this is happening to repeatedly almost
  // certainly has a physical sealing problem recalibration can't fix by
  // cycling it, not a one-off estimate drift. `thresholdCount` or more
  // completed recalibrations (either outcome) within
  // `chronic_window_hours` marks the zone chronic — flagged clearly in the
  // dashboard and always emailed (see vent_misalignment_alert_enabled's
  // own comment), but still commanded normally: there's no way yet for a
  // person to manually clear a "locked out" zone, so degrading its control
  // would just make comfort worse with no compensating benefit. Clears
  // only when a person manually acknowledges it (there's no automatic
  // self-healing check for "is the physical vent actually fixed now") or
  // its own rolling window ages the qualifying occurrences out.
  vent_misalignment_chronic_threshold_count: z
    .number()
    .int()
    .positive()
    .default(3),
  vent_misalignment_chronic_window_hours: z.number().positive().default(2),
  // Demand stall detection — the mirror-image failure to vent
  // misalignment above: a *demanding* zone whose vent Flair confirms
  // reaching a real, meaningfully-open commanded position, but whose room
  // temperature shows no genuine improvement anyway. Found live (Martin
  // Office, 2026-09-15): demanding for over an hour, vent confirmed
  // cycling through 0/10/20/30% the whole time, temp never moved toward
  // setpoint, and the vent was in fact physically closed regardless of
  // what Flair reported — the AC kept running the whole time for a zone
  // that could never actually benefit, wasting real energy on every other
  // zone sharing the same call. Detection anchors per-zone temp across a
  // single continuous "demanding, call active" stretch (see
  // ZoneRuntimeState.demand_stall_window_since/_start_temp), reset the
  // instant either condition breaks. Unlike vent misalignment, mitigation
  // doesn't wait on a recalibration attempt to also fail first: the zone
  // is marked stalled (see demand_stalled_since, read by isEligible() in
  // drivingZone.ts to exclude it from keeping the call running)
  // immediately once a detection window elapses with no improvement, and
  // clears itself the moment a later window shows real progress. A
  // best-effort force-open home cycle (same shape as vent misalignment's
  // own) runs in parallel, independently gated by its own cooldown, as a
  // cheap attempt at an actual fix rather than only working around the
  // symptom. Defaults to off — like vent misalignment, this changes real
  // call-continuation behavior, so it ships opt-in.
  demand_stall_detection_enabled: z.boolean().default(false),
  // PLACEHOLDER pending real-world tuning — deliberately much shorter
  // than zone_no_improvement_alert_minutes (45): that alert only ever
  // fires once a zone is already commanded near its own ceiling, so it
  // can afford to wait; this fires on a zone that might be sitting at a
  // low, unremarkable-looking position the whole time; per the live
  // 2026-09-15 incident this began, waiting 45 minutes (or worse, a full
  // hour+) to notice — let alone act — is the exact problem being fixed.
  demand_stall_detection_minutes: z.number().positive().default(12),
  demand_stall_temp_threshold_c: z.number().positive().default(0.56),
  // How long a zone must stay clear of a completed (or abandoned, see
  // demand_stall_max_open_wait_minutes) force-open attempt before another
  // is tried — independent of demand_stalled_since itself, which is not
  // gated by this cooldown at all (see the feature's own comment above).
  // PLACEHOLDER pending real-world tuning.
  demand_stall_recalibration_cooldown_hours: z.number().positive().default(4),
  // Safety timeout on the force-open attempt — mirrors
  // vent_misalignment_max_open_wait_minutes's own reasoning exactly.
  demand_stall_max_open_wait_minutes: z.number().positive().default(10),
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
  // How long a continuously-true occupied signal is trusted for granting
  // a zone protection from closing (Step 1's satisfied-branch, the
  // idle-baseline calculation, and Step 3's contention bucket). Sourced
  // directly, not guessed: Flair's own support documentation states
  // Ecobee SmartSensors report a room "occupied" for a documented 30
  // minutes after the last real motion — found live, 2026-09-07, after
  // two bedrooms sat fully open (unconditionally protected) for 20-30
  // minutes with nobody in them while a different room was demanding.
  // Past this window, a sustained "occupied" reading is no longer trusted
  // and the zone falls through to its normal unoccupied behavior.
  occupancy_trust_window_minutes: z.number().positive().default(30),

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
  // Raised from the spec's originally-stated 15-minute default to 25 after
  // real production telemetry showed this house's Ecobee/Flair reporting
  // cadence routinely produces gaps up to ~30 minutes with no correlation to
  // any actual sensor problem (~8% of all reading updates, house-wide, not
  // zone-specific) — 15 minutes was generating false-positive staleness
  // alerts/exclusions on ordinary reporting lag, not real freezes.
  stale_threshold_minutes: z.number().positive().default(25),
  // A distinct, looser sibling of stale_threshold_minutes — that setting
  // fires on "the reading hasn't *changed*," which is expected/benign for
  // an observation-only zone nobody spends time in; this fires on "no
  // reading has arrived *at all*" (`calibratedTemp` null — see
  // ingestZoneRoomReading), which is a real connectivity/hardware signal
  // regardless of how a zone is tracked. Looser than the 25-minute stale
  // threshold for the same reason that one was raised from 15: ordinary
  // Flair/Ecobee reporting gaps shouldn't false-positive as "offline."
  sensor_offline_alert_minutes: z.number().positive().default(60),

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
  // A real, confirmed false-positive class distinct from the near-closed-vent
  // one below: a variable-speed unit legitimately running at a low capacity
  // stage (overnight, light load) can produce a real, healthy duct
  // differential that's a little short of the configured threshold — not a
  // fault, just a smaller true differential than a full-capacity call
  // produces. Confirmed live: 5 overnight triggers, every one on a genuinely
  // open vent with a real 4-5°C differential, every one self-clearing within
  // 6-7 minutes once the differential drifted back over threshold — the
  // signature of a borderline reading, not a sustained equipment problem.
  // Mirrors the clear-side dwell above: the failing condition must persist
  // for this long before a fault is actually declared, so one marginal tick
  // can't trip the whole-system fail-safe on its own.
  equipment_fault_trigger_dwell_minutes: z.number().positive().default(3),
  // A real, confirmed false-positive fail-safe trigger: a smart vent
  // sitting near-closed (satisfied, resting low) has little real airflow
  // through its own duct segment, so its duct temperature drifts toward
  // room-ambient rather than reflecting what the compressor is actually
  // producing — a bad witness for "is the equipment working," not evidence
  // of a fault. Confirmed live: a call sustained entirely by two
  // duct-sensorless manual-vent zones, while every smart vent happened to
  // be satisfied-and-mostly-closed at the same moment, left no genuinely
  // usable duct reading at all and tripped a false fault. A vent below
  // this position is excluded from the "usable" set for both
  // detectEquipmentFault and detectDuctAirflowAnomaly, the same way a
  // stale or missing reading already is.
  equipment_fault_min_vent_open_pct: z.number().min(0).max(100).default(20),
  // Alert-only backstop, never a fail-safe trigger — see the plan.
  hvac_no_improvement_alert_minutes: z.number().positive().default(75),
  // The zone-scoped sibling of the above, added after live hardware
  // verification confirmed a vent can silently under-actuate in a way
  // neither reconciliation nor the whole-system alert can catch — see
  // "Emergency fail-safe" in the plan. Shorter than the whole-system
  // threshold since a single stuck zone is a narrower, easier-to-confirm
  // signal than a whole handler's call length. PLACEHOLDER.
  zone_no_improvement_alert_minutes: z.number().positive().default(45),
  // Capacity sharing: a real, confirmed gap found live — the aggregate open
  // area on "Upstairs" sat above 190% of rated capacity all day, every
  // sample, with three demanding zones sharing the same fixed blower
  // output as several manual_fixed_vent zones and a smart-vent zone that
  // stays pinned at its 100% idle baseline nearly permanently (see
  // step1DesiredPosition.ts's own comment — a "satisfied" zone only closes
  // once it overshoots *past* its tolerance band, never merely for being
  // right at target). Nothing today lets a comfortable zone sacrifice
  // margin for a struggling sibling; every zone's position is driven
  // purely by its own deviation. When enabled, reuses
  // zone_no_improvement_alert_minutes's own trigger (a zone commanded near
  // its ceiling with no measurable improvement, from the zone-scoped
  // no-improvement check just above) as the signal to pull every eligible
  // (not capacity_sharing_exempt), currently-satisfied flair_smart_vent
  // zone on the same air handler down to its own min_vent_position — full
  // authority, not a capped fraction, since a merely-satisfied zone isn't
  // giving up genuine comfort, just unclaimed headroom. Never overrides a
  // zone with an active Sleep Mode window — see pipeline.ts's own ordering.
  // Defaults to off: this changes real HVAC behavior for zones other than
  // the struggling one, so it ships opt-in rather than silently changing
  // what every existing installation does.
  capacity_sharing_enabled: z.boolean().default(false),
  // Isolated per-zone duct-airflow anomaly (this vent fails the duct-temp
  // differential while a sibling passes) — reuses
  // equipment_fault_duct_delta_threshold_c for the threshold itself, but
  // needs a longer sustained-duration before alerting since this is
  // diagnostic, not protective, and benefits from more confidence.
  duct_anomaly_alert_minutes: z.number().positive().default(20),

  // --- Comfort / deadband ---
  // 2°F → 1.11°C (Config-time validation section).
  heat_cool_deadband_min_c: z.number().positive().default(1.11),
  // A real, confirmed gap found live via shadow-mode evaluation: a
  // zone/schedule-event demand tolerance left unset (or set very tight)
  // means an effectively-zero deadband, which real sensor noise alone
  // (confirmed live: a bedroom's own reading wobbling ~0.5°C around its
  // setpoint with nothing actually wrong) is enough to flip
  // satisfied/demanding classification every tick — and since a zone's
  // idle_baseline_position commonly equals its max_vent_position, any
  // "demanding" tick — even a hairline one — snaps its target straight
  // back to fully open, undoing whatever proportional closing had already
  // happened. This floor guarantees every zone gets at least this much
  // real deadband on the demand side regardless of what's configured —
  // "0.1" in a schedule still means "at least this," never truly zero.
  // Deliberately NOT applied to comfort_overshoot_tolerance — a tight or
  // zero overshoot tolerance is the entire point of that field (e.g. "never
  // let this room undercool below setpoint during the day"), and
  // classifyWithStabilization's dwell-based debounce already protects
  // against noise-driven flapping there without needing a magnitude
  // floor too. ~1°F default; the real noise observed live was closer to
  // 0.5°C in amplitude, so this may need to go higher via System
  // Parameters once you've watched a few real cycles.
  minimum_comfort_tolerance_c: z.number().min(0).max(2.78).default(0.56),
  // The companion fix, layered on top of the floor above: even with a real
  // deadband, a zone whose actual temperature happens to sit close to its
  // own boundary can still cross it occasionally on pure noise. Mirrors
  // spike detection's/occupancy's own stabilization-dwell pattern — a raw
  // classification only takes effect once it's held steady for this long,
  // not on the first tick it appears. Default chosen to absorb a few
  // single-tick blips (at the standard 60s tick interval) without making a
  // genuine transition feel sluggish.
  classification_stabilization_minutes: z.number().min(0).default(3),

  // --- Fallback baselines ---
  // No specific figures stated in the plan. PLACEHOLDER (~75°F / ~70°F).
  fallback_setpoint_cool: z.number().default(23.89),
  fallback_setpoint_heat: z.number().default(21.11),

  // --- Alerting ---
  // "default 70%, i.e. 35 of 50" (Token persistence section).
  token_budget_alert_threshold_pct: z.number().min(0).max(100).default(70),
  // In-process rate floor on notifyOnce (Email alerting section: "~15 min").
  email_rate_floor_minutes: z.number().positive().default(15),
  // A connectivity concern, not a comfort one — alerted much sooner than
  // the comfort-related "no improvement" thresholds. No specific figure
  // stated in the plan. PLACEHOLDER.
  flair_outage_alert_minutes: z.number().positive().default(5),
  // Unlike a Flair outage, a failing HomeKit connection never stops vent
  // control — it only silently disables early call termination (the
  // setpoint-push mechanism that ends a call once every zone is already
  // satisfied instead of running to the thermostat's own setpoint). A
  // real, confirmed incident (2026-09-12/13) ran undetected for 30+ hours
  // because nothing alerted on it at all. Defaulted to the same dwell as
  // vent_degraded_alert_minutes rather than flair_outage's aggressive 5
  // minutes, since a brief mDNS/pairing blip is expected background noise
  // for this integration and shouldn't page on its own.
  homekit_outage_alert_minutes: z.number().positive().default(30),
  // "default every 24h" (Manual disarm section).
  disarm_reminder_interval_hours: z.number().positive().default(24),
  // No specific figure stated for vent-degraded alert duration. PLACEHOLDER.
  vent_degraded_alert_minutes: z.number().positive().default(30),

  // --- Time / display ---
  // Bootstrap-seed only — see Environment & Dev Modes; this row is what's
  // actually authoritative after first boot.
  home_timezone: z.string().default("America/Phoenix"),
  display_temperature_unit: z.enum(["C", "F"]).default("F"),
  // Per-browser-overridable display unit for airflow-rating fields
  // (duct_flow_rate_lps) — same system-wide-default-with-per-browser-
  // override pattern as display_temperature_unit, see the Settings page.
  // "Lps" (the canonical stored unit) is the safe default absent any
  // browser or system preference.
  display_airflow_unit: z.enum(["Lps", "CFM", "M3h"]).default("Lps"),
});

export type SystemSettingsConfig = z.infer<typeof systemSettingsConfigSchema>;

export function resolveSystemSettings(stored: unknown): SystemSettingsConfig {
  return systemSettingsConfigSchema.parse(stored ?? {});
}

/**
 * A genuine partial of `systemSettingsConfigSchema` for PATCH request
 * bodies — `.partial()` alone is NOT safe here for the identical reason
 * `zoneConfigPartialSchema` exists (see that schema's own comment):
 * `updateSettingsForInstallation` merges the patch onto the existing row
 * (`{...existing, ...patch}`), so a `.partial()`-parsed patch that's been
 * silently backfilled with every field's default would wipe every setting
 * the caller never intended to touch — e.g. a minimal
 * `{ display_temperature_unit: "F" }` PATCH (exactly what the Settings
 * page's temperature-unit toggle sends) would otherwise reset
 * `control_disarmed`, `live_air_handler_ids`, `zone_priority_order`, and
 * everything else back to their schema defaults.
 */
export const systemSettingsConfigPartialSchema = genuinePartial(
  systemSettingsConfigSchema,
);
