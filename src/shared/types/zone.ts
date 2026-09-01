// Per-vent outcomes — genuinely per-vent, not per-zone, since one vent can
// stall while its sibling reconciles fine. One entry per zone.config
// .flair_vent_ids member. See "Multi-Vent Zones" in the implementation
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
  // in flair_vent_ids is commanded toward this same value. See "Multi-Vent
  // Zones".
  last_target_position: number | null;
  last_commanded_at: string | null; // ISO instant
  // One entry per zone.config.flair_vent_ids member, same order. Empty for
  // manual_fixed_vent/no_vent zones (nothing to reconcile).
  vents: VentRuntimeState[];
  last_reading_value: number | null; // calibrated Celsius
  last_reading_changed_at: string | null;
  stale: boolean;
  spike_active: boolean;
  spike_since: string | null;
  // The previous tick's satisfied/demanding classification — the input
  // classifyStaleness()'s "not already satisfied" gate needs, since a
  // comfortable room's reading is unchanging by design. See "Stale sensor
  // reading safeguard".
  last_classification:
    "satisfied" | "demanding" | "unclassified_no_sensor" | null;
  // Debounced occupancy state — mirrors spike_active/spike_since's shape.
  // The live signal (`remote-sensor-readings.occupied`, confirmed present
  // via a targeted live check — see docs/flair-api-schema.md) is fed
  // through this hysteresis before being unioned with any schedule-driven
  // Sleep Mode override. See "Occupancy" in the implementation plan.
  occupied: boolean;
  occupancy_pending_flip_since: string | null;
}

export const EMPTY_ZONE_RUNTIME_STATE: ZoneRuntimeState = {
  last_target_position: null,
  last_commanded_at: null,
  vents: [],
  last_reading_value: null,
  last_reading_changed_at: null,
  stale: false,
  spike_active: false,
  spike_since: null,
  last_classification: null,
  occupied: false,
  occupancy_pending_flip_since: null,
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
