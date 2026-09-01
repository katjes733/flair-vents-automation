// Durable runtime state — written only on change (diff-checked), kept in a
// separate `state` JSONB column from `config` since it churns and
// configuration doesn't. See Data Model / zones in the implementation plan.
// Not Zod-validated like the config schemas: this is written exclusively by
// the control loop, never user input, so there's no save-time validation
// boundary for it to cross.
export interface ZoneRuntimeState {
  last_target_position: number | null;
  last_commanded_at: string | null; // ISO instant
  last_reported_position: number | null;
  degraded: boolean;
  degraded_since: string | null;
  reconcile_attempts: number;
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
  last_reported_position: null,
  degraded: false,
  degraded_since: null,
  reconcile_attempts: 0,
  last_reading_value: null,
  last_reading_changed_at: null,
  stale: false,
  spike_active: false,
  spike_since: null,
  last_classification: null,
  occupied: false,
  occupancy_pending_flip_since: null,
};
