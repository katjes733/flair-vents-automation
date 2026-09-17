// Per-vent outcomes — genuinely per-vent, not per-zone, since one vent can
// stall while its sibling reconciles fine. One entry per zone.config
// .flair_vents member. See "Multi-Vent Zones" in the implementation
// plan for why these specific four fields (and no others) moved out of
// ZoneRuntimeState: they're the fields whose zone-level-scalar treatment
// would let a healthy vent mask a stuck sibling's own last-reported
// position or degraded state.
export interface VentRuntimeState {
  flair_vent_id: string;
  last_reported_position: number | null;
  degraded: boolean;
  degraded_since: string | null;
  reconcile_attempts: number;
}

// Durable runtime state — written only on change (diff-checked), kept in a
// separate `state` JSONB column from `config` since it churns and
// configuration doesn't. See Data Model / zones in the implementation plan.
// Not Zod-validated like the config schemas: this is written exclusively by
// the control loop, never user input, so there's no save-time validation
// boundary for it to cross.
export interface ZoneRuntimeState {
  // Ramp-continuity state — stays zone-level (not per-vent) because the
  // position pipeline only ever produces one target per zone; every vent
  // in flair_vents is commanded toward this same value. See "Multi-Vent
  // Zones".
  last_target_position: number | null;
  last_commanded_at: string | null; // ISO instant
  // One entry per zone.config.flair_vents member, same order. Empty for
  // manual_fixed_vent/no_vent zones (nothing to reconcile).
  vents: VentRuntimeState[];
  last_reading_value: number | null; // calibrated Celsius
  last_reading_changed_at: string | null;
  // Distinct from last_reading_changed_at's own staleness signal — this
  // tracks "no reading has arrived at all" (calibratedTemp null), not "the
  // reading hasn't changed." Set the first tick a reading is missing,
  // cleared the moment one resumes. See sensor_offline_alert_minutes.
  sensor_offline_since: string | null;
  stale: boolean;
  spike_active: boolean;
  spike_since: string | null;
  // The previous tick's *stabilized* satisfied/demanding classification —
  // the input classifyStaleness()'s "not already satisfied" gate needs,
  // since a comfortable room's reading is unchanging by design (see "Stale
  // sensor reading safeguard"), and also the anchor `stabilizeClassification`
  // itself debounces against — see the two fields below.
  last_classification:
    "satisfied" | "demanding" | "unclassified_no_sensor" | null;
  // The hysteresis dwell for the classification boundary itself — mirrors
  // spike_active/spike_since's shape. A raw classification that disagrees
  // with `last_classification` sits here, pending, until it's held steady
  // for `classification_stabilization_minutes` — see
  // `stabilizeClassification` in comfortTolerance.ts.
  classification_pending_value:
    "satisfied" | "demanding" | "unclassified_no_sensor" | null;
  classification_pending_since: string | null;
  // Debounced occupancy state — mirrors spike_active/spike_since's shape.
  // The live signal (`remote-sensor-readings.occupied`, confirmed present
  // via a targeted live check — see docs/flair-api-schema.md) is fed
  // through this hysteresis before being unioned with any schedule-driven
  // Sleep Mode override. See "Occupancy" in the implementation plan.
  occupied: boolean;
  occupancy_pending_flip_since: string | null;
  // How long the debounced live signal above has been continuously true —
  // distinct from occupancy_pending_flip_since, which clears the moment a
  // flip stabilizes. Ecobee's own SmartSensors report a room "occupied"
  // for a documented 30 minutes after the *last* real motion (per Flair's
  // own support docs), so "occupied: true" alone can't distinguish someone
  // still in the room from someone who left up to half an hour ago. See
  // occupancy.ts's resolveTrustedOccupancy() and
  // system_settings.occupancy_trust_window_minutes.
  occupied_since: string | null;
  // Sleep-mode quiet anchor (see sleep_quiet_anchor_enabled) — the position
  // last captured on a demanding->satisfied transition (or periodic
  // re-anchor) while satisfied and Sleep Mode is active, held flat instead
  // of re-running the overshoot ramp every tick. null whenever the zone is
  // demanding, Sleep Mode isn't active, or the feature is disabled.
  sleep_quiet_anchor_position: number | null;
  sleep_quiet_anchor_since: string | null;
  // Vent misalignment auto-recalibration (see
  // vent_misalignment_auto_recalibration_enabled) — the window fields
  // anchor a *single continuous* stretch of "reported 0%, satisfied,
  // COOLING_CALL/HEATING_CALL active"; reset to null the instant any of
  // those breaks (an idle-segment rebound is normal and not diagnostic —
  // see the setting's own comment). recalibrating_since is non-null only
  // while a triggered home cycle is actively holding the zone open,
  // waiting for it to actually report there. last_recalibrated_at gates
  // vent_misalignment_recalibration_cooldown_hours, set on both a
  // completed cycle and one abandoned via
  // vent_misalignment_max_open_wait_minutes — a vent that never actually
  // opens shouldn't be retried every tick either.
  vent_misalignment_window_since: string | null;
  vent_misalignment_window_start_temp: number | null;
  vent_misalignment_recalibrating_since: string | null;
  // Which source started the in-progress (or most recently finished)
  // cycle — "manual" for an explicit maintenance trigger, "auto" for the
  // detector's own temp-drift window. Null whenever recalibrating_since is
  // also null. See VentMisalignmentTrigger's own comment.
  vent_misalignment_recalibration_trigger: "auto" | "manual" | null;
  vent_misalignment_last_recalibrated_at: string | null;
  // A rolling "quick view" audit trail, not a lifetime total — one ISO
  // timestamp per completed *auto*-triggered recalibration cycle (either
  // outcome; a manually-triggered one is deliberately never added here —
  // see isChronicallyMisaligned's own comment), pruned to the trailing 24h
  // on every tick the feature runs. Deeper analysis (which zone, what time
  // of day, how long each cycle's own open took) is expected to come from
  // the structured Loki events instead of this list, which exists to
  // answer "is this actively happening to this zone right now" at a
  // glance, and is also the entire input to chronic-escalation detection.
  vent_misalignment_recalibration_history: string[];
  // Set by a person requesting a manual recalibration (see
  // dashboard.zone.ventRecalibration.trigger) — an ISO timestamp of the
  // request, cleared by the tick loop the instant it's actually consumed
  // (starts a fresh recalibratingSinceMs). Left set if a *different* cycle
  // happens to already be in progress when the request arrives, so it's
  // picked up as soon as that one finishes rather than silently dropped.
  vent_manual_recalibration_requested_at: string | null;
  // Which hardware extreme (0 or 100) the in-progress (or most recently
  // finished) cycle is forcing the vent toward — see
  // evaluateVentMisalignment's farthestExtremeFrom comment. Null whenever
  // recalibrating_since is also null.
  vent_misalignment_target_extreme_pct: 0 | 100 | null;
  // Demand stall detection (see demand_stall_detection_enabled) — the
  // mirror-image failure to vent misalignment above: a *demanding* zone
  // whose vent Flair confirms reaching a real, non-floor commanded
  // position, but whose room temperature shows no genuine improvement —
  // found live (Martin Office, 2026-09-15): over an hour demanding,
  // vent confirmed at 0/10/20/30% throughout, temp never moved toward
  // setpoint, and the physical vent was in fact fully closed regardless
  // of what Flair reported. Window fields anchor a *single continuous*
  // "demanding, call active" stretch, reset to null the instant either
  // breaks (mirrors vent_misalignment_window_since's own reset shape).
  // recalibrating_since is non-null only while a best-effort force-open
  // attempt is in progress. last_recalibrated_at gates
  // demand_stall_recalibration_cooldown_hours, same shape as the
  // vent-misalignment cooldown. stalled_since is the actual mitigation
  // flag — non-null the instant a detection window elapses with no real
  // improvement (independent of whether a force-open attempt is also in
  // flight), read by isEligible() (drivingZone.ts) to stop this zone from
  // being treated as a reason to keep the call running. Cleared the
  // moment a later window shows genuine improvement — self-healing, no
  // manual reset needed.
  demand_stall_window_since: string | null;
  demand_stall_window_start_temp: number | null;
  demand_stall_recalibrating_since: string | null;
  demand_stall_last_recalibrated_at: string | null;
  demand_stalled_since: string | null;
}

export const EMPTY_ZONE_RUNTIME_STATE: ZoneRuntimeState = {
  last_target_position: null,
  last_commanded_at: null,
  vents: [],
  last_reading_value: null,
  last_reading_changed_at: null,
  sensor_offline_since: null,
  stale: false,
  spike_active: false,
  spike_since: null,
  last_classification: null,
  classification_pending_value: null,
  classification_pending_since: null,
  occupied: false,
  occupancy_pending_flip_since: null,
  occupied_since: null,
  sleep_quiet_anchor_position: null,
  sleep_quiet_anchor_since: null,
  vent_misalignment_window_since: null,
  vent_misalignment_window_start_temp: null,
  vent_misalignment_recalibrating_since: null,
  vent_misalignment_recalibration_trigger: null,
  vent_misalignment_last_recalibrated_at: null,
  vent_misalignment_recalibration_history: [],
  vent_manual_recalibration_requested_at: null,
  vent_misalignment_target_extreme_pct: null,
  demand_stall_window_since: null,
  demand_stall_window_start_temp: null,
  demand_stall_recalibrating_since: null,
  demand_stall_last_recalibrated_at: null,
  demand_stalled_since: null,
};

/** A zone is degraded if any of its vents are — see "Multi-Vent Zones". */
export function isZoneDegraded(state: ZoneRuntimeState): boolean {
  return state.vents.some((v) => v.degraded);
}

/**
 * `MIN` over currently-degraded vents' own `degraded_since`, so a
 * long-stuck vent's alert timer isn't reset by an unrelated sibling
 * recovering, and a newly-stuck sibling still gets its own fresh timer.
 * `null` when no vent is currently degraded.
 */
export function zoneDegradedSince(state: ZoneRuntimeState): string | null {
  const since = state.vents
    .filter((v) => v.degraded && v.degraded_since !== null)
    .map((v) => v.degraded_since as string);
  if (since.length === 0) return null;
  return since.reduce((min, s) => (s < min ? s : min));
}

/** The vent state for a given id, or undefined if it's not (yet) tracked. */
export function ventState(
  state: ZoneRuntimeState,
  flairVentId: string,
): VentRuntimeState | undefined {
  return state.vents.find((v) => v.flair_vent_id === flairVentId);
}

/**
 * `persistZoneState`'s merge (control/scheduler.ts) is shallow — a patch of
 * `{vents: [...]}` replaces the whole array rather than merging one
 * element. This is the one shared helper every call site updating a single
 * vent's state must use, so three independently-written merges can't drift
 * — see "Multi-Vent Zones".
 */
export function patchVentState(
  vents: VentRuntimeState[],
  flairVentId: string,
  patch: Partial<Omit<VentRuntimeState, "flair_vent_id">>,
): VentRuntimeState[] {
  const existing = vents.find((v) => v.flair_vent_id === flairVentId);
  const updated: VentRuntimeState = existing
    ? { ...existing, ...patch }
    : {
        flair_vent_id: flairVentId,
        last_reported_position: null,
        degraded: false,
        degraded_since: null,
        reconcile_attempts: 0,
        ...patch,
      };
  return existing
    ? vents.map((v) => (v.flair_vent_id === flairVentId ? updated : v))
    : [...vents, updated];
}
