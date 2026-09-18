# Genuine idle reuses fan_only_idle_baseline_position instead of a new setting

Raised while designing a fix for a real, observed annoyance: vents only
ever react to system changes after the fact. When a call starts — whether
triggered by this app's own driving-setpoint push or by the thermostat's
own schedule — a previously-satisfied zone's vent is still sitting wherever
its last comfort computation left it, and only catches up once a later
tick recomputes it. Chasing that gap (a separate, still-in-progress
mechanism) surfaced a more fundamental question first: what *should* a
satisfied zone's resting position be while genuinely idle, and is that the
same question `comfort_idle_baseline_position` already answers?

It isn't. `comfort_idle_baseline_position` is the demanding/satisfied
curve's own continuity anchor (`step1DesiredPosition.ts`), and it has to
stay low (0, per its own comment) for one specific scenario: a zone that's
satisfied *while a sibling zone is actively being conditioned*. Every
percent open there is real conditioned air diverted from a zone that needs
it right now — that's the 190%-capacity incident already documented
against this setting. But a zone that's satisfied while *no call is active
anywhere* is a different situation entirely: there's no conditioned air
being produced to conserve, so resting open costs nothing, and it directly
helps the still-in-progress "avoid a pressure spike when the next call
starts" work by giving the system standing headroom instead of a fully
closed vent to reopen from scratch. `computeZoneCommands` already ran the
identical formula for both cases (via `ARBITRARY_IDLE_CALL_STATE`'s own
"IDLE uses the same math as an active call" design), silently applying the
wrong scenario's anchor to the second one.

The first attempt at fixing this introduced a dedicated new setting,
`true_idle_baseline_position`, mirroring `idle_baseline_position`/
`fan_only_idle_baseline_position`'s own shape. That was a mistake, caught
before it shipped: `fan_only_idle_baseline_position` already represents
exactly the concept needed — "how far open should a zone rest while
nothing is being conditioned" — and genuine idle fits that description at
least as well as FAN_ONLY does (FAN_ONLY at least has the blower moving
real air; genuine idle has nothing moving at all, so resting open costs
even less). Piling on a second, near-duplicate setting for a distinction
the existing one already draws was exactly the kind of unnecessary
proliferation worth avoiding.

## Decision

`fan_only_idle_baseline_position`'s scope widens from "FAN_ONLY only" to
"any stretch with no call active anywhere" — no new setting, no schema
rename (renaming the persisted key would risk losing already-configured
values on existing installations for no real benefit; only its comment
changed to describe the broader scope). `computeZoneCommands` resolves
`callActive ? idleBaselinePosition : fanOnlyIdleBaselinePosition` once per
zone and feeds that single value into the exact same formulas
`idleBaselinePosition` alone used to feed (the demanding/satisfied curve,
`effectiveIdleBaseline`'s inactive/stale/no-sensor branches) — not a
parallel computation path. The ordinary (non-sleep) FAN_ONLY branch is
unaffected; it already used `fanOnlyIdleBaselinePosition` directly and
still does.

The resolved value is exposed on `PipelineResult` as
`effectiveIdleBaselines`, keyed per zone. This exists for one specific
consistency reason: `stepDelta.ts`'s dispatch-bypass heuristic (skip the
quiet-dispatch suppressor once a target crosses above idle baseline, so a
freshly-demanding zone isn't stuck waiting for the ordinary threshold)
needs to check against the *same* anchor the demand-floor math actually
used that tick. Independently re-deriving just `idle_baseline_position ??
comfort_idle_baseline_position` there would silently disagree the instant
`callActive` is false — exactly the kind of bug that's easy to introduce
by re-deriving a value in two places instead of computing it once and
passing it through.

## Consequences

No new UI surface, no new config validation, no migration — every
installation's existing `fan_only_idle_baseline_position` value (whatever
it's set to today) now also governs genuine idle, effective immediately on
deploy. `fan_only_idle_baseline_position`'s own default (50, per ADR-0003's
update) needed no further change — it was already tuned for "moderate,
not maxed" reasoning that applies equally well to the newly-widened scope.

## Update (ADR-0008)

`comfort_idle_baseline_position`/`idle_baseline_position` — referenced
throughout this decision under their names at the time — were renamed to
`satisfied_baseline_position` (same name at both the system and per-zone
level) once the "comfort"/"idle" naming was flagged as actively confusing.
See [[rename-comfort-idle-baseline-to-satisfied-baseline]] (ADR-0008) for
the rename itself; the decision recorded above is otherwise unchanged.

## Update (ADR-0009)

`fan_only_idle_baseline_position` — the setting this decision widened in
scope, referenced throughout under its name at the time — was itself
renamed to `no_call_active_baseline_position` once its own name was
flagged as stale for the same reason: it still said "fan_only" despite
this decision having widened it to cover genuine IDLE too. See
[[rename-fan-only-idle-baseline-and-minimum-comfort-tolerance]] (ADR-0009).
