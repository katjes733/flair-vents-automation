# Rename comfort_idle_baseline_position to satisfied_baseline_position

Raised while reviewing [[idle-baseline-reuse-for-genuine-idle]] (ADR-0006):
asked why the system-wide setting governing "how open should a vent be
while satisfied" wasn't simply raised directly, instead of building a
separate fast-transition mechanism. Answering that question required
naming which of two settings was meant — and the existing name,
`comfort_idle_baseline_position`, made that harder than it should have
been.

The word "idle" is actively backwards: this setting only ever applies
*while a call is active* elsewhere on the air handler — a zone satisfied
while a sibling zone is still being conditioned. It never applies during
idle; `fan_only_idle_baseline_position` governs any stretch with no call
active anywhere (both FAN_ONLY and, since ADR-0006, genuine IDLE too). So
the setting named "idle" is the one that never applies during idle, and
the one that actually governs idle carries "fan_only" in its name from
before ADR-0006 widened its scope. "Comfort" added no real disambiguating
meaning either — both settings ultimately serve comfort in some sense.

Compounding the confusion: the per-zone override wasn't even named to
match its own system-wide fallback. The system setting was
`comfort_idle_baseline_position`; the zone-level override for the exact
same concept was `idle_baseline_position` — a second, different name for
one thing, at two levels of the same config.

## Decision

Renamed to `satisfied_baseline_position` at both levels — matching
`fan_only_idle_baseline_position`'s own same-name-at-both-levels pattern,
where a zone override and its system-wide fallback share one name. This
is a pure rename: no behavior change, no default change, no change to
which formula consumes the value or when.

Scope of the rename:

- `systemSettings.ts`: `comfort_idle_baseline_position` →
  `satisfied_baseline_position`.
- `zoneConfig.ts`: `idle_baseline_position` → `satisfied_baseline_position`
  (now matching the system-wide key exactly).
- `pipeline.ts`: `PipelineZoneInput.idleBaselinePosition` (the raw,
  per-zone field) → `satisfiedBaselinePosition`; the local
  `effectiveComfortIdleBaseline` variable → `resolvedIdleBaseline`.
- `validateConfig.ts`: the `idleBaselinePosition` validation param →
  `satisfiedBaselinePosition`; its error code `idle_baseline_out_of_range`
  → `satisfied_baseline_out_of_range`.
- Every other raw-field reference across `tick.ts`, `zoneService.ts`, the
  client (`zonesApi.ts`, `systemParameterFields.ts`,
  `ZoneDetailDialog.tsx`), and their tests.

Deliberately **not** renamed: the generic `idleBaselinePosition` parameter
threaded through `occupancy.ts`'s `effectiveIdleBaseline`,
`step1DesiredPosition.ts`'s own interface, `dispatcher.ts`, and
`stepDelta.ts`. That name is accurate as it stands — it's the caller's
*already-resolved* value for a non-demanding zone, generic across both the
satisfied-while-active and genuinely-idle/fan-only cases (`pipeline.ts`
resolves `callActive ? satisfiedBaselinePosition : fanOnlyIdleBaselinePosition`
before passing it in). Renaming that generic parameter to match either
specific source setting would make it *less* accurate, not more.
`PipelineResult.effectiveIdleBaselines` (the per-zone exposed map, feeding
`stepDelta.ts`'s dispatch-bypass consistency check) is the same kind of
generic, correctly-scoped value and was left alone for the same reason.

Migration: both `system_settings.config` and `zones.config` are opaque
`jsonb` columns (no schema migration needed for a key rename), but a
Zod-parsed config silently drops an unrecognized key and applies the new
key's schema default — so a stored value under the old key name would be
silently lost on the next parse/save without an explicit data migration.
Ran a one-time, idempotent `UPDATE` against production (the only
environment this installation runs against) renaming the JSON key in both
tables wherever the old key was present, verified before commit against a
`SELECT` of the affected rows.

## Consequences

No behavior change — every resolved value, default, and formula input is
identical before and after. The per-zone override now shares its exact
name with its system-wide fallback, matching `fan_only_idle_baseline_position`'s
own convention, so a future reader no longer has to hold two different
names in mind for one concept. `bun run tsc`/`bun run test`/`bun run
verify` all pass unchanged in count (1797 tests), confirming the rename
touched identifiers and labels only.

Historical ADRs (0003, 0006) and `docs/recommendation-engine-candidates.md`
were left using the old names — they're point-in-time records of decisions
and incidents as understood when written, not living documentation.
