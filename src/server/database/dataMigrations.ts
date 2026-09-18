import type { DataSource } from "typeorm";

// One-off, idempotent fixups for data already stored inside a jsonb `config`
// column — the kind of change dataSource.synchronize() (structural: tables,
// columns) can't express, since it has no notion of a key's *name* inside a
// jsonb blob. Each entry here must stay safe to run on every boot forever:
// guarded by a `WHERE config ? 'old_key'` (or equivalent) so it's a no-op
// once applied, with nothing tracking "already ran" — the guard itself is
// the tracking. Run in order, after synchronize() (see datasource.ts),
// so a rename here always targets a schema that already has the shape the
// *new* code expects.
export interface DataMigration {
  name: string;
  run: (dataSource: DataSource, schema: string) => Promise<void>;
}

export const dataMigrations: DataMigration[] = [
  {
    // See ADR-0008 (docs/adr/0008-rename-comfort-idle-baseline-to-satisfied-baseline.md).
    name: "rename comfort_idle_baseline_position/idle_baseline_position to satisfied_baseline_position",
    run: async (dataSource, schema) => {
      await dataSource.query(
        `UPDATE "${schema}".system_settings
         SET config = (config - 'comfort_idle_baseline_position')
           || jsonb_build_object(
                'satisfied_baseline_position',
                config->'comfort_idle_baseline_position'
              )
         WHERE config ? 'comfort_idle_baseline_position'`,
      );
      await dataSource.query(
        `UPDATE "${schema}".zones
         SET config = (config - 'idle_baseline_position')
           || jsonb_build_object(
                'satisfied_baseline_position',
                config->'idle_baseline_position'
              )
         WHERE config ? 'idle_baseline_position'`,
      );
    },
  },
  {
    // See ADR-0009 (docs/adr/0009-rename-fan-only-idle-baseline-and-minimum-comfort-tolerance.md).
    // Same key name at both levels before and after, unlike the migration
    // above — fan_only_idle_baseline_position was already consistently
    // named at both levels, so this is a straight rename on each table.
    name: "rename fan_only_idle_baseline_position to no_call_active_baseline_position",
    run: async (dataSource, schema) => {
      await dataSource.query(
        `UPDATE "${schema}".system_settings
         SET config = (config - 'fan_only_idle_baseline_position')
           || jsonb_build_object(
                'no_call_active_baseline_position',
                config->'fan_only_idle_baseline_position'
              )
         WHERE config ? 'fan_only_idle_baseline_position'`,
      );
      await dataSource.query(
        `UPDATE "${schema}".zones
         SET config = (config - 'fan_only_idle_baseline_position')
           || jsonb_build_object(
                'no_call_active_baseline_position',
                config->'fan_only_idle_baseline_position'
              )
         WHERE config ? 'fan_only_idle_baseline_position'`,
      );
    },
  },
  {
    // See ADR-0009. System-wide only — no per-zone override exists for this
    // setting.
    name: "rename minimum_comfort_tolerance_c to minimum_demand_tolerance_c",
    run: async (dataSource, schema) => {
      await dataSource.query(
        `UPDATE "${schema}".system_settings
         SET config = (config - 'minimum_comfort_tolerance_c')
           || jsonb_build_object(
                'minimum_demand_tolerance_c',
                config->'minimum_comfort_tolerance_c'
              )
         WHERE config ? 'minimum_comfort_tolerance_c'`,
      );
    },
  },
];
