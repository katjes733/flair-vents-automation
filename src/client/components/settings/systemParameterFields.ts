import {
  systemSettingsConfigSchema,
  type SystemSettingsConfig,
} from "~/shared/schemas/systemSettings";
import {
  asAbsoluteTemp,
  asTempDelta,
  toDisplayAbsolute,
  fromDisplayAbsolute,
  toDisplayDelta,
  fromDisplayDelta,
  type TemperatureUnit,
} from "~/shared/types/temperature";
import { toDisplayFlowRate, fromDisplayFlowRate } from "~/shared/types/airflow";
import type { AirflowUnit } from "~/shared/types/airflow";

// The real, DB-backed control-loop schema defaults — computed from the
// actual server schema (parsing an empty object triggers every field's own
// `.default()`) rather than a hand-copied constant list, so this can never
// drift from what `resolveSystemSettings()` actually resolves server-side.
export const SYSTEM_SETTINGS_DEFAULTS: SystemSettingsConfig =
  systemSettingsConfigSchema.parse({});

export type ParamKind =
  | "tempAbsolute"
  | "tempDelta"
  | "tempRatePerMin"
  | "airflow"
  | "plainNumber"
  | "int"
  | "percent"
  | "minutes"
  | "seconds"
  | "hours"
  | "enum"
  | "text";

export interface ParamFieldOption {
  value: string;
  label: string;
}

export type ParamTier = "common" | "advanced";

export interface ParamFieldDef {
  path: string;
  baseLabel: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  /**
   * A plain-English explanation of what this setting actually does,
   * shown as hover text (an info icon next to the field) rather than an
   * always-visible caption — with ~40 fields on this page, a caption per
   * field would overload the UI far more than an on-demand tooltip does.
   */
  description: string;
  /**
   * "common" fields are the small, day-to-day comfort-tuning set shown by
   * default (comfort responsiveness, away/fallback setpoints, staleness,
   * timezone). "advanced" is everything else — internal ramp/contention
   * mechanics, spike-detection signal processing, the Ecobee offset
   * mechanism, equipment-protection thresholds, alerting cadence — real
   * settings, just not ones most people need to touch to tune comfort,
   * and in a few cases (fail-safe/pressure thresholds) genuinely
   * hazard-adjacent if changed without understanding them. Hidden behind
   * a page-local "Show advanced" toggle rather than deleted or buried in
   * docs, so they're still one click away.
   */
  tier: ParamTier;
  options?: ParamFieldOption[];
}

export interface ParamGroupDef {
  title: string;
  fields: ParamFieldDef[];
}

export interface DisplayUnits {
  temperatureUnit: TemperatureUnit;
  airflowUnit: AirflowUnit;
}

/** Generic dot-path getter — supports the one level of nesting `modifier_boosts.*` needs. */
export function getByPath(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
}

/** Generic dot-path setter — returns a new object, never mutates `obj`. */
export function setByPath<T extends object>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) {
    return { ...obj, [head]: value };
  }
  const nested = (obj as Record<string, unknown>)[head];
  return {
    ...obj,
    [head]: setByPath(
      (nested && typeof nested === "object" ? nested : {}) as object,
      rest.join("."),
      value,
    ),
  };
}

/** The unit token shown in a field's label — dynamic for unit-preference-dependent kinds. */
export function paramUnitLabel(kind: ParamKind, units: DisplayUnits): string {
  switch (kind) {
    case "tempAbsolute":
    case "tempDelta":
      return `°${units.temperatureUnit}`;
    case "tempRatePerMin":
      return `°${units.temperatureUnit}/min`;
    case "airflow":
      return units.airflowUnit === "Lps"
        ? "L/s"
        : units.airflowUnit === "CFM"
          ? "CFM"
          : "m³/h";
    case "percent":
      return "%";
    case "minutes":
      return "min";
    case "seconds":
      return "s";
    case "hours":
      return "h";
    case "int":
      return "";
    default:
      return "";
  }
}

/** Converts a stored (canonical) value into the string shown in the field's input. */
export function toDisplayString(
  kind: ParamKind,
  storedValue: unknown,
  units: DisplayUnits,
): string {
  if (kind === "text" || kind === "enum") return String(storedValue ?? "");
  const raw = Number(storedValue);
  if (!Number.isFinite(raw)) return "";
  switch (kind) {
    case "tempAbsolute":
      return String(
        round(toDisplayAbsolute(asAbsoluteTemp(raw), units.temperatureUnit)),
      );
    case "tempDelta":
    case "tempRatePerMin":
      return String(
        round(toDisplayDelta(asTempDelta(raw), units.temperatureUnit)),
      );
    case "airflow":
      return String(round(toDisplayFlowRate(raw, units.airflowUnit)));
    default:
      return String(round(raw));
  }
}

/** Converts a field's display-string input back into the canonical stored value. */
export function fromDisplayString(
  kind: ParamKind,
  displayValue: string,
  units: DisplayUnits,
): unknown {
  if (kind === "text" || kind === "enum") return displayValue;
  const parsed = Number(displayValue);
  if (!Number.isFinite(parsed)) return NaN;
  switch (kind) {
    case "tempAbsolute":
      return fromDisplayAbsolute(parsed, units.temperatureUnit);
    case "tempDelta":
    case "tempRatePerMin":
      return fromDisplayDelta(parsed, units.temperatureUnit);
    case "airflow":
      return fromDisplayFlowRate(parsed, units.airflowUnit);
    default:
      return parsed;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Whether two already-rounded *display* strings represent the same value —
 * deliberately compared in display space, not by round-tripping each back
 * through a unit conversion into canonical storage units first. A
 * conversion + 2-decimal rounding + the inverse conversion does not
 * round-trip exactly (e.g. 1.67°C -> 3.01°F rounded -> 1.6722°C, a ~0.002
 * drift) — comparing canonical values with a small epsilon looked
 * reasonable but was actually too fragile: real fields legitimately drift
 * past any epsilon tight enough to still catch a genuine 1-unit edit,
 * which showed up as untouched fields spuriously marked dirty on load.
 * Comparing what's actually shown (both sides rounded identically) has no
 * such gap.
 */
export function sameDisplayValue(
  kind: ParamKind,
  a: string,
  b: string,
): boolean {
  if (kind === "text" || kind === "enum") return a === b;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return na === nb;
}

const BUCKET_MODE_OPTIONS: ParamFieldOption[] = [
  { value: "bucket_major", label: "Spiking → occupied → unoccupied buckets" },
  { value: "priority_only", label: "Priority order only (no bucketing)" },
];

// Every scalar (non-picker) system_settings.config tunable, grouped to
// match the schema's own section comments — see
// src/shared/schemas/systemSettings.ts. The 4 picker-shaped fields
// (zone_priority_order, away_native_zone_ids, live_air_handler_ids,
// driving_zone_overrides) and control_disarmed/display_* live elsewhere
// (GlobalStatusBar, the Settings page, and their own future zone/air-handler
// picker UI) — deliberately not duplicated here.
export const SYSTEM_PARAMETER_GROUPS: ParamGroupDef[] = [
  {
    title: "Position & ramp",
    fields: [
      {
        path: "proportional_band_width",
        baseLabel: "Proportional band width",
        kind: "tempDelta",
        step: 0.1,
        description:
          "How far a zone's temperature has to drift from its setpoint before its vent reaches fully open (or fully closed once satisfied). Narrower = vents respond more aggressively to small deviations; wider = gentler, slower response.",
        tier: "common",
      },
      {
        path: "max_position_pct",
        baseLabel: "Max vent position",
        kind: "percent",
        min: 0,
        max: 100,
        description:
          "The absolute ceiling every computed vent position is capped at, regardless of demand. Lower this to cap how far open any vent is ever allowed to go, house-wide.",
        tier: "common",
      },
      {
        path: "modifier_boosts.occupancy",
        baseLabel: "Occupancy boost",
        kind: "plainNumber",
        min: 0,
        step: 0.1,
        description:
          "How much narrower the comfort band gets for an occupied zone. 0.3 shrinks the band by about 23%, making an occupied room respond faster than an identical unoccupied one, in both heating and cooling.",
        tier: "advanced",
      },
      {
        path: "modifier_boosts.spike",
        baseLabel: "Spike boost",
        kind: "plainNumber",
        min: 0,
        step: 0.1,
        description:
          "Same effect as the occupancy boost, but applied to a zone currently flagged as thermally spiking — makes it respond faster for as long as the spike is active. Cooling-call only (heating chokes a spiking zone instead — see Heating choke position).",
        tier: "advanced",
      },
      {
        path: "modifier_boosts.high_internal_heat_load",
        baseLabel: "High internal heat load boost",
        kind: "plainNumber",
        min: 0,
        step: 0.1,
        description:
          "Extra responsiveness during cooling calls for a zone flagged with a high internal heat load (electronics, direct sun, etc.). Inverted into a choke during heating, since a naturally-hot room needs less heat, not more.",
        tier: "advanced",
      },
      {
        path: "modifier_boosts.distant_high_duct_loss",
        baseLabel: "Distant / high duct-loss boost",
        kind: "plainNumber",
        min: 0,
        step: 0.1,
        description:
          "Extra responsiveness during cooling calls for a zone flagged as having a long or lossy duct run. Unlike the heat-load boost, this one carries through unchanged during heating too — a lossy duct loses conditioned air either direction.",
        tier: "advanced",
      },
      {
        path: "heating_choke_position_pct",
        baseLabel: "Heating choke position",
        kind: "percent",
        min: 15,
        max: 25,
        description:
          "The hard ceiling a high-internal-heat-load or actively spiking zone's vent is held to during a heating call, so a room that already runs hot doesn't get flooded with more heat.",
        tier: "advanced",
      },
      {
        path: "modulation_step_pct",
        baseLabel: "Ramp step size",
        kind: "percent",
        min: 0,
        max: 100,
        description:
          "How large one ramp step is, in percentage points, each time a vent moves toward a new target position. Larger steps reach the target faster but move more abruptly.",
        tier: "advanced",
      },
      {
        path: "max_steps_per_tick",
        baseLabel: "Max ramp steps per tick",
        kind: "int",
        min: 1,
        description:
          "How many ramp steps a vent is allowed to take within a single control tick. Raising this closes a large gap to target faster, at the cost of a bigger single movement.",
        tier: "advanced",
      },
      {
        path: "min_step_delta_pct",
        baseLabel: "Min dispatch step delta",
        kind: "percent",
        min: 0,
        max: 100,
        description:
          "How far a vent's computed position has to move, compared against its last actually-dispatched position (not the ramp target), before a new command is sent at all — filters out tiny, noisy corrections.",
        tier: "advanced",
      },
      {
        path: "sleep_mode_min_step_delta_pct",
        baseLabel: "Sleep Mode min dispatch step delta",
        kind: "percent",
        min: 0,
        max: 100,
        description:
          "The wider version of the dispatch threshold above, used only while a zone's Sleep Mode is active — fewer, larger corrections instead of frequent small motor noises overnight. Comfort accuracy is unaffected; only how often a correction is bothered with changes.",
        tier: "advanced",
      },
      {
        path: "drift_check_interval_ticks",
        baseLabel: "Drift check interval",
        kind: "int",
        min: 1,
        description:
          "How often, in ticks, a vent's actual reported position is re-checked against its intended target as a backstop — independent of normal dispatch, so a vent that silently drifts between commands still gets caught.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Contention resolution",
    fields: [
      {
        path: "bucket_mode",
        baseLabel: "Zone ranking mode",
        kind: "enum",
        options: BUCKET_MODE_OPTIONS,
        description:
          "How zones are ranked when there isn't enough airflow capacity for everyone's demand at once. The default protects spiking and occupied zones from being reduced first; the alternative ranks purely by your configured priority order, ignoring spike/occupancy status.",
        tier: "common",
      },
    ],
  },
  {
    title: "Pressure safeguard",
    fields: [
      {
        path: "default_zone_flow_rate_lps",
        baseLabel: "Default zone duct rating",
        kind: "airflow",
        min: 0,
        description:
          "The airflow rating assumed for any vent with no configured duct rating of its own — keeps the pressure-safeguard math working even for unrated vents, rather than treating them as contributing zero airflow.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Occupancy",
    fields: [
      {
        path: "unoccupied_idle_factor",
        baseLabel: "Unoccupied idle factor",
        kind: "plainNumber",
        min: 0,
        max: 1,
        step: 0.05,
        description:
          "How much an unoccupied, satisfied zone's resting vent position is scaled down during FAN_ONLY/IDLE. Doesn't apply during an active call — there, an unoccupied satisfied zone closes all the way to its floor instead. Lower values leave more airflow available for occupied rooms.",
        tier: "common",
      },
      {
        path: "occupancy_stabilization_minutes",
        baseLabel: "Occupancy stabilization dwell",
        kind: "minutes",
        min: 0,
        description:
          "How long an occupancy reading has to hold steady before it's trusted — guards against a flickering sensor repeatedly flipping a zone's priority and idle-position treatment.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Dynamic thermal spike detection",
    fields: [
      {
        path: "spike_window_minutes",
        baseLabel: "Spike buffer window",
        kind: "minutes",
        min: 1,
        description:
          "How much recent temperature history is kept per zone when checking whether it's heating or cooling unusually fast.",
        tier: "advanced",
      },
      {
        path: "spike_rate_threshold_c_per_min",
        baseLabel: "Spike rate threshold",
        kind: "tempRatePerMin",
        min: 0,
        step: 0.1,
        description:
          "The rate of temperature change that counts as a real 'spike' and triggers extra responsiveness for that zone.",
        tier: "advanced",
      },
      {
        path: "spike_clear_rate_threshold_c_per_min",
        baseLabel: "Spike clear rate threshold",
        kind: "tempRatePerMin",
        min: 0,
        step: 0.1,
        description:
          "The (lower) rate the temperature has to fall back below before a spike is considered over — a gap between this and the trigger threshold stops a borderline reading from flapping in and out of spike state.",
        tier: "advanced",
      },
      {
        path: "spike_stabilization_minutes",
        baseLabel: "Spike stabilization dwell",
        kind: "minutes",
        min: 0,
        description:
          "How long the rate has to stay below the clear threshold before a spike is actually cleared, once it has already triggered.",
        tier: "advanced",
      },
      {
        path: "spike_min_samples",
        baseLabel: "Min samples before trusting slope",
        kind: "int",
        min: 1,
        description:
          "The minimum number of readings required before a computed rate-of-change is trusted at all — guards against a false spike being read off just one or two data points.",
        tier: "advanced",
      },
      {
        path: "spike_min_span_minutes",
        baseLabel: "Min time span before trusting slope",
        kind: "minutes",
        min: 0,
        description:
          "The minimum real time those samples have to span before the slope is trusted — guards against readings that happened to arrive close together looking like an artificially fast spike.",
        tier: "advanced",
      },
      {
        path: "spike_plausibility_cap_c_per_min",
        baseLabel: "Implausible-jump cap",
        kind: "tempRatePerMin",
        min: 0,
        step: 0.1,
        description:
          "A rate of change above this is treated as an implausible sensor glitch (e.g. a delayed reading suddenly catching up) rather than a real spike, and is rejected.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Stale sensor reading safeguard",
    fields: [
      {
        path: "stale_threshold_minutes",
        baseLabel: "Staleness threshold",
        kind: "minutes",
        min: 1,
        description:
          "How long a zone's reading can stay completely unchanged before it's treated as stale. A stale zone is excluded from active position control and its vent rests at its idle baseline until fresh data resumes — this is the safeguard behind the incident that originally motivated it (a frozen reading holding a vent open indefinitely).",
        tier: "common",
      },
    ],
  },
  {
    title: "Driving setpoint (Ecobee mechanism)",
    fields: [
      {
        path: "drive_zone_switch_margin_c",
        baseLabel: "Tracked-zone switch margin",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "How much worse another zone's deviation has to be than the currently-tracked zone's before the system even considers switching which zone governs the thermostat's setpoint.",
        tier: "advanced",
      },
      {
        path: "drive_zone_switch_dwell_ticks",
        baseLabel: "Tracked-zone switch dwell",
        kind: "int",
        min: 0,
        description:
          "How many ticks that lead has to persist before tracking actually switches zones — prevents two nearly-tied zones from flip-flopping which one governs the call.",
        tier: "advanced",
      },
      {
        path: "setpoint_push_rounding_c",
        baseLabel: "Setpoint push rounding",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "The precision the computed setpoint is rounded to before it's written to the thermostat.",
        tier: "advanced",
      },
      {
        path: "offset_max_c",
        baseLabel: "Max offset correction",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "The largest correction ever applied between the thermostat's own reading and the tracked zone's real temperature — caps how far the pushed setpoint can diverge from the tracked zone's actual target, so the correction can never run away.",
        tier: "advanced",
      },
      {
        path: "offset_smoothing_alpha",
        baseLabel: "Offset smoothing rate",
        kind: "plainNumber",
        min: 0,
        max: 1,
        step: 0.05,
        description:
          "How quickly that correction reacts to a change — a new tracked zone, a shifting gap. Higher values respond faster but less smoothly; lower values are gentler but lag behind a real change longer.",
        tier: "advanced",
      },
      {
        path: "termination_margin_c",
        baseLabel: "Termination margin",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "How close to the thermostat's own current reading the pushed setpoint snaps once every currently-demanding zone on the handler is satisfied, so the call ends promptly instead of drifting to a stop.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Away Mode",
    fields: [
      {
        path: "away_setpoint_cool",
        baseLabel: "Away cooling setpoint",
        kind: "tempAbsolute",
        step: 0.5,
        description:
          "The cooling target used for any zone currently marked away.",
        tier: "common",
      },
      {
        path: "away_setpoint_heat",
        baseLabel: "Away heating setpoint",
        kind: "tempAbsolute",
        step: 0.5,
        description:
          "The heating target used for any zone currently marked away.",
        tier: "common",
      },
      {
        path: "away_tolerance",
        baseLabel: "Away tolerance",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "The wider comfort tolerance applied to an away zone in place of its normal one — how much drift from the away setpoint is allowed before that zone's vent responds at all.",
        tier: "common",
      },
    ],
  },
  {
    title: "Sensor disagreement",
    fields: [
      {
        path: "sensor_disagreement_threshold_c",
        baseLabel: "Disagreement threshold",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "How far apart two sensors in the same room have to read before it's flagged as a disagreement worth investigating. Has no effect today — dormant until a room has more than one sensor.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Control loop",
    fields: [
      {
        path: "control_tick_interval_seconds",
        baseLabel: "Tick interval",
        kind: "seconds",
        min: 1,
        description:
          "How often the control loop runs end-to-end — every zone re-evaluated, every vent re-commanded if needed. Shorter is more responsive but spends more of Flair's API rate budget for no real gain, since sensor reporting itself is the actual freshness bottleneck, not this interval.",
        tier: "advanced",
      },
      {
        path: "tick_watchdog_seconds",
        baseLabel: "Tick watchdog timeout",
        kind: "seconds",
        min: 1,
        description:
          "The maximum time a single tick is allowed to run before it's abandoned and the loop reschedules anyway — protects against a stuck tick silently stopping the whole system.",
        tier: "advanced",
      },
      {
        path: "reconciliation_retry_count",
        baseLabel: "Reconciliation retry count",
        kind: "int",
        min: 0,
        description:
          "How many times a dispatched command is re-checked against the vent's reported position before giving up and marking that vent degraded.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Emergency fail-safe",
    fields: [
      {
        path: "equipment_fault_grace_period_minutes",
        baseLabel: "Fault detection grace period",
        kind: "minutes",
        min: 0,
        description:
          "How long a call has to be running before the duct-temperature fault check even starts looking — covers normal compressor/blower startup lag so a healthy startup isn't mistaken for a fault.",
        tier: "advanced",
      },
      {
        path: "equipment_fault_duct_delta_threshold_c",
        baseLabel: "Duct-temperature differential threshold",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "How far a smart vent's duct temperature has to differ from its room's temperature to count as evidence the equipment is actually producing conditioned air. If every vent fails this check past the grace period, the whole-system fail-safe forces every vent open.",
        tier: "advanced",
      },
      {
        path: "equipment_fault_clear_dwell_minutes",
        baseLabel: "Fault-clear dwell",
        kind: "minutes",
        min: 0,
        description:
          "How long the duct differential has to stay healthy before a triggered fail-safe is actually cleared, rather than clearing the instant one good reading comes in.",
        tier: "advanced",
      },
      {
        path: "hvac_no_improvement_alert_minutes",
        baseLabel: "Extended call, no improvement (whole system)",
        kind: "minutes",
        min: 0,
        description:
          "How long a call can run with no zone anywhere on the handler getting measurably closer to target before an alert fires. Alert-only — this never forces vents open the way the duct-differential fail-safe does, since a legitimately hot day can look identical to a real problem here.",
        tier: "advanced",
      },
      {
        path: "zone_no_improvement_alert_minutes",
        baseLabel: "Zone demand, no improvement",
        kind: "minutes",
        min: 0,
        description:
          "The same idea as the whole-system alert above, scoped to one specific zone commanded near its own ceiling with a deviation that genuinely isn't shrinking. Alert-only, per zone.",
        tier: "advanced",
      },
      {
        path: "duct_anomaly_alert_minutes",
        baseLabel: "Isolated duct anomaly alert dwell",
        kind: "minutes",
        min: 0,
        description:
          "How long one zone's duct differential can look wrong while a sibling zone on the same handler looks fine before it's flagged as a likely blocked or disconnected duct for that zone specifically, rather than an equipment-wide fault.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Comfort / deadband",
    fields: [
      {
        path: "heat_cool_deadband_min_c",
        baseLabel: "Minimum heat/cool deadband",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "The minimum required gap between a zone's heat and cool setpoints, enforced when saving a schedule or zone — stops a configuration where the system would end up fighting itself, alternating heat and cool.",
        tier: "advanced",
      },
      {
        path: "minimum_comfort_tolerance_c",
        baseLabel: "Minimum comfort tolerance",
        kind: "tempDelta",
        min: 0,
        step: 0.1,
        description:
          "A floor applied to every zone's resolved comfort tolerance, including an unset or explicit-zero schedule tolerance — so a room configured for tight targeting still gets at least this much deadband against ordinary sensor noise, instead of flapping between satisfied and demanding every tick.",
        tier: "advanced",
      },
      {
        path: "classification_stabilization_minutes",
        baseLabel: "Classification stabilization dwell",
        kind: "minutes",
        min: 0,
        description:
          "How long a zone's satisfied/demanding reading has to hold steady before it's actually accepted — a single noisy tick that disagrees with the current classification is held over rather than immediately flipping it (and, for a zone whose idle baseline equals its max position, snapping straight back open).",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Fallback baselines",
    fields: [
      {
        path: "fallback_setpoint_cool",
        baseLabel: "Fallback cooling setpoint",
        kind: "tempAbsolute",
        step: 0.5,
        description:
          "The cooling target used for any zone with no active schedule event, no manual override, and not marked away.",
        tier: "common",
      },
      {
        path: "fallback_setpoint_heat",
        baseLabel: "Fallback heating setpoint",
        kind: "tempAbsolute",
        step: 0.5,
        description:
          "The heating target used for any zone with no active schedule event, no manual override, and not marked away.",
        tier: "common",
      },
    ],
  },
  {
    title: "Alerting",
    fields: [
      {
        path: "token_budget_alert_threshold_pct",
        baseLabel: "Flair token budget alert threshold",
        kind: "percent",
        min: 0,
        max: 100,
        description:
          "What percentage of Flair's daily token-creation budget (roughly 50 tokens/day) triggers a warning email, so a runaway refresh pattern is caught well before the budget is actually exhausted and Flair calls start failing.",
        tier: "advanced",
      },
      {
        path: "email_rate_floor_minutes",
        baseLabel: "Email rate floor",
        kind: "minutes",
        min: 0,
        description:
          "A hard floor on how often the same alert can email you, even if the normal per-alert dedup logic fails (e.g. during a Redis outage) — a safety net against an email flood, not the primary dedup mechanism.",
        tier: "advanced",
      },
      {
        path: "flair_outage_alert_minutes",
        baseLabel: "Flair outage alert threshold",
        kind: "minutes",
        min: 0,
        description:
          "How long Flair's API has to be unreachable before an outage alert fires.",
        tier: "advanced",
      },
      {
        path: "disarm_reminder_interval_hours",
        baseLabel: "Disarm reminder interval",
        kind: "hours",
        min: 0,
        description:
          "How often a reminder email re-fires while manual control is disarmed. Deliberately re-fires on this interval rather than sending once and going quiet, so a temporary check-in can't be silently forgotten for days.",
        tier: "advanced",
      },
      {
        path: "vent_degraded_alert_minutes",
        baseLabel: "Vent degraded alert threshold",
        kind: "minutes",
        min: 0,
        description:
          "How long a vent can sit degraded (reconciliation exhausted its retries) before an alert fires for it.",
        tier: "advanced",
      },
    ],
  },
  {
    title: "Time",
    fields: [
      {
        path: "home_timezone",
        baseLabel: "Home timezone",
        kind: "text",
        description:
          "An IANA timezone name, e.g. America/Denver. Used for schedule evaluation and daily resets — independent of whatever timezone your browser happens to be in, and not browser-detected.",
        tier: "common",
      },
    ],
  },
];
