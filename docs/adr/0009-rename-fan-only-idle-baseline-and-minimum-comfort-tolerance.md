# Rename fan_only_idle_baseline_position and minimum_comfort_tolerance_c

Follow-up to [[rename-comfort-idle-baseline-to-satisfied-baseline]]
(ADR-0008): asked whether any other setting had the same class of bug — a
name that no longer accurately describes what it does or when it applies.
A systematic pass over every field in `systemSettings.ts`/`zoneConfig.ts`,
cross-checked against actual usage rather than each field's own claims,
turned up two more genuine cases.

## `fan_only_idle_baseline_position` → `no_call_active_baseline_position`

The exact same shape of bug as ADR-0008, and self-admitted in the
setting's own comment: *"Originally scoped to FAN_ONLY only (hence the
name); genuine IDLE shares the identical... justification... this one's
scope was widened instead"* (ADR-0006). Since that widening, this setting
governs any stretch with no call active anywhere — both FAN_ONLY and
genuine IDLE — but the name still claims only the narrower, historical
scope. A reader going by the name alone would wrongly assume it has no
effect during genuine idle.

Renamed at both levels (system-wide and per-zone override — this setting
was already consistently named at both, unlike ADR-0008's case) to
`no_call_active_baseline_position`, naming it after the exact condition it
actually gates: `!callActive`, the same boolean already used throughout
`pipeline.ts`/`tick.ts` to distinguish this scenario from an active call.

## `minimum_comfort_tolerance_c` → `minimum_demand_tolerance_c`

This setting floors *only* the demand-side comfort tolerance — deliberately
never the overshoot side, since a tight or zero overshoot tolerance is the
entire point of that separate field (`resolveTargets.ts`'s
`applyMinimumToleranceFloor` only ever writes `demandTolerance`). But its
name said "comfort tolerance" broadly, as if it covered the whole comfort
deadband.

The clearest evidence this was already a known, live inconsistency: the
settings UI itself had already drifted away from the schema name —
`systemParameterFields.ts` labeled this exact field **"Minimum demand
tolerance"** for users, while the underlying config key still said
`minimum_comfort_tolerance_c`. The UI's own label was correct; the schema
key was stale. Renamed the schema key to match what the UI already told
users this setting does.

## Decision

Both are pure renames — no behavior, default, or formula change. Scope
mirrors ADR-0008: schema fields (`systemSettings.ts`, and
`zoneConfig.ts` for the per-zone `no_call_active_baseline_position`
override), every `PipelineZoneInput`/internal reference in `pipeline.ts`,
`resolveTargets.ts`'s `minimumDemandTolerance` field, the client
(`zonesApi.ts`, `systemParameterFields.ts`, `ZoneDetailDialog.tsx` —
including its local form-state variable, previously `fanOnlyIdleBaseline`,
now `noCallActiveBaseline`), and all affected tests.

Left unchanged for the same reason as ADR-0008: `PipelineResult
.effectiveIdleBaselines` and the generic `idleBaselinePosition` parameter
threaded through `occupancy.ts`/`step1DesiredPosition.ts`/
`dispatcher.ts`/`stepDelta.ts` — those are the caller's already-resolved
value, generic across both baseline scenarios by design, not a specific
setting's name.

Added two more entries to `dataMigrations.ts` (see ADR-0008 for why this
mechanism exists and runs where it does — after `dataSource.synchronize()`
on every boot, idempotent via `WHERE config ? 'old_key'`). Both verified
against a throwaway local Postgres container seeded with representative
old-key data, confirming a correct rename and idempotency on a second run;
production was not touched directly — the migration applies itself the
next time the new code boots.

## Consequences

No behavior change. `bun run tsc`/`bun run test`/`bun run verify` all pass
unchanged (1797 tests). The settings UI's `minimum_demand_tolerance_c`
label needed no change — it was already correct; only the schema key
needed to catch up to it. `no_call_active_baseline_position`'s UI label
changed from "Fan-only idle baseline" to "No-call baseline (FAN_ONLY /
idle)" to match its actual scope.

The remaining candidate the audit surfaced,
`equipment_fault_min_vent_open_pct` (also consumed by the separate
duct-anomaly detector, not just the equipment-fault one its name implies),
was deliberately left unrenamed — its own comment already discloses the
dual use, so it's narrowly named but not actually misleading to a reader
who reads past the field name itself.
