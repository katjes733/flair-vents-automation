// `logger` is the global Bun-preloaded pino instance (see global.d.ts) —
// every emit helper below takes an already-scoped child logger, matching
// the rest of the codebase's `logger.child({...})` convention.
type Logger = ReturnType<typeof logger.child>;

// The single source of truth for every named log event this system emits —
// see "Logging, Redaction & Observability" in the implementation plan. Call
// sites use these helpers, never a raw `logger.*` call with a hand-typed
// field object, so field names stay consistent everywhere an event fires.
// Field-naming convention: snake_case; id fields suffixed `_id`; no unit
// suffix on temperatures (always Celsius); `_pct`/`_lps`/`_ms`/`_seconds`
// where applicable; booleans as bare past-participles/adjectives.

export interface HvacStateTransitionFields {
  air_handler_id: string;
  from: string;
  to: string;
  call_source: string;
  dry_run: boolean;
}
export function logHvacStateTransition(
  log: Logger,
  fields: HvacStateTransitionFields,
): void {
  log.info(fields, "HVAC state transition");
}

export interface ZoneEvaluatedFields {
  air_handler_id: string;
  zone_id: string;
  temp_raw: number | null;
  temp_calibrated: number | null;
  setpoint: number | null;
  tolerance: number | null;
  deviation: number | null;
  desired_position_pct: number | null;
  satisfied: boolean;
  dry_run: boolean;
}
export function logZoneEvaluated(
  log: Logger,
  fields: ZoneEvaluatedFields,
): void {
  log.debug(fields, "Zone evaluated");
}

export interface ZoneExcludedFields {
  air_handler_id: string;
  zone_id: string;
  reason: "tolerance" | "stale" | "inactive";
  dry_run: boolean;
}
export function logZoneExcluded(log: Logger, fields: ZoneExcludedFields): void {
  log.debug(fields, "Zone excluded");
}

export interface ContentionResolvedFields {
  air_handler_id: string;
  candidates: Array<{ zone_id: string; bucket: string; rank: number }>;
  reductions: Record<string, number>;
  insufficient: boolean;
  dry_run: boolean;
}
export function logContentionResolved(
  log: Logger,
  fields: ContentionResolvedFields,
): void {
  log.info(fields, "Contention resolved");
}

export interface PressureSafeguardEvaluatedFields {
  air_handler_id: string;
  aggregate_open_lps: number;
  aggregate_open_pct: number;
  floor_lps: number;
  cap_pct: number;
  clamped: boolean;
  blower_rated_flow_rate_is_estimate: boolean;
  minimum_aggregate_flow_is_estimate: boolean;
  dry_run: boolean;
}
export function logPressureSafeguardEvaluated(
  log: Logger,
  fields: PressureSafeguardEvaluatedFields,
): void {
  const level = fields.clamped ? "warn" : "debug";
  log[level](fields, "Pressure safeguard evaluated");
}

export interface DrivingSetpointComputedFields {
  air_handler_id: string;
  driving_zone_id: string | null;
  selection_reason: string;
  pushed_value: number | null;
  pushed_value_c: number | null;
  thermostat_reading: number | null;
  would_write: boolean;
  dry_run: boolean;
}
export function logDrivingSetpointComputed(
  log: Logger,
  fields: DrivingSetpointComputedFields,
): void {
  log.info(fields, "Driving setpoint computed");
}

export interface VentCommandDispatchedFields {
  air_handler_id: string;
  zone_id: string;
  target_pct: number;
  reported_pct: number | null;
  step_delta_pct: number;
  dry_run: boolean;
}
export function logVentCommandDispatched(
  log: Logger,
  fields: VentCommandDispatchedFields,
): void {
  log.info(fields, "Vent command dispatched");
}

export interface VentCommandSuppressedFields {
  air_handler_id: string;
  zone_id: string;
  target_pct: number;
  last_dispatched_pct: number | null;
  step_delta_pct: number;
}
export function logVentCommandSuppressed(
  log: Logger,
  fields: VentCommandSuppressedFields,
): void {
  log.debug(fields, "Vent command suppressed");
}

export interface VentReconciledFields {
  air_handler_id: string;
  zone_id: string;
  attempt: number;
  reported_pct: number;
}
export function logVentReconciled(
  log: Logger,
  fields: VentReconciledFields,
): void {
  log.info(fields, "Vent reconciled");
}

export interface VentDegradedFields {
  air_handler_id: string;
  zone_id: string;
  reconcile_attempts: number;
  last_reported_pct: number | null;
}
export function logVentDegraded(log: Logger, fields: VentDegradedFields): void {
  log.warn(fields, "Vent degraded");
}

export interface ThermalSpikeFields {
  air_handler_id: string;
  zone_id: string;
  rate_per_min: number | null;
  threshold: number;
  window_s: number;
}
export function logThermalSpikeDetected(
  log: Logger,
  fields: ThermalSpikeFields,
): void {
  log.warn(fields, "Thermal spike detected");
}
export function logThermalSpikeDecayed(
  log: Logger,
  fields: ThermalSpikeFields,
): void {
  log.info(fields, "Thermal spike decayed");
}

export interface ZoneTelemetryPolledFields {
  air_handler_id: string;
  zone_id: string;
  reading_changed: boolean;
  reading_age_seconds: number;
}
export function logZoneTelemetryPolled(
  log: Logger,
  fields: ZoneTelemetryPolledFields,
): void {
  log[fields.reading_changed ? "info" : "debug"](
    fields,
    "Zone telemetry polled",
  );
}

export interface EmergencyFailSafeFields {
  air_handler_id: string;
  fault_signal: string;
  duct_delta_c: number | null;
}
export function logEmergencyFailSafeTriggered(
  log: Logger,
  fields: EmergencyFailSafeFields,
): void {
  log.error(fields, "Emergency fail-safe triggered");
}
export function logEmergencyFailSafeCleared(
  log: Logger,
  fields: EmergencyFailSafeFields,
): void {
  log.info(fields, "Emergency fail-safe cleared");
}

export interface HvacNoImprovementFields {
  air_handler_id: string;
  call_duration_minutes: number;
  zones_evaluated: number;
}
export function logHvacExtendedCallNoImprovement(
  log: Logger,
  fields: HvacNoImprovementFields,
): void {
  log.warn(fields, "HVAC extended call with no improvement");
}

export interface FlairSetpointWriteFailingFields {
  air_handler_id: string;
  written_failures: number;
}
export function logFlairSetpointWriteFailing(
  log: Logger,
  fields: FlairSetpointWriteFailingFields,
): void {
  log.warn(fields, "Flair setpoint write failing");
}

export interface DuctAirflowAnomalyFields {
  air_handler_id: string;
  zone_id: string;
  duct_delta_c: number | null;
  commanded_position_pct: number;
}
export function logDuctAirflowAnomalyDetected(
  log: Logger,
  fields: DuctAirflowAnomalyFields,
): void {
  log.warn(fields, "Duct airflow anomaly detected");
}
export function logDuctAirflowAnomalyCleared(
  log: Logger,
  fields: DuctAirflowAnomalyFields,
): void {
  log.info(fields, "Duct airflow anomaly cleared");
}

export interface ControlDisarmFields {
  actor: string;
}
export function logControlDisarmed(
  log: Logger,
  fields: ControlDisarmFields,
): void {
  log.warn(fields, "Control disarmed");
}
export function logControlRearmed(
  log: Logger,
  fields: ControlDisarmFields,
): void {
  log.info(fields, "Control rearmed");
}

export interface ControlTickCompletedFields {
  air_handler_id: string;
  duration_ms: number;
  zones_evaluated: number;
  commands_dispatched: number;
}
export function logControlTickCompleted(
  log: Logger,
  fields: ControlTickCompletedFields,
): void {
  log.info(fields, "Control tick completed");
}

// The exhaustive per-tick record — see "Comprehensive tick decision
// record". No fixed field shape here (the record's own type lives in
// control/tickDecision.ts) since this is deliberately exhaustive rather
// than a fixed dashboard-facing shape.
export function logControlTickDecision(log: Logger, decision: unknown): void {
  log.debug({ decision }, "Control tick decision");
}

export interface StartupReconciliationCompletedFields {
  air_handler_id: string;
  vents_checked: number;
  mismatches_found: number;
}
export function logStartupReconciliationCompleted(
  log: Logger,
  fields: StartupReconciliationCompletedFields,
): void {
  log.info(fields, "Startup reconciliation completed");
}

// The periodic backstop (Resolved Design Decisions), distinct from
// "Startup reconciliation completed" — same math, but this fires
// mid-run, on drift_check_interval_ticks, not once at boot, so it needs
// its own event rather than reusing that one's log line.
export interface DriftCheckCompletedFields {
  air_handler_id: string;
  vents_checked: number;
  mismatches_found: number;
}
export function logDriftCheckCompleted(
  log: Logger,
  fields: DriftCheckCompletedFields,
): void {
  log.info(fields, "Drift check completed");
}
