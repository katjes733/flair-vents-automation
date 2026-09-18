# Fast transition takes larger ramp steps across a call-state flip

The [[idle-baseline-reuse-for-genuine-idle]] work (ADR-0006) gave a
genuinely idle zone somewhere useful to rest — open enough to avoid a
fully-closed vent needing to reopen from scratch — but it didn't address
the transition itself. Whether resting at the widened idle baseline or at
0, a zone still has to move to its new target only `modulation_step_pct *
max_steps_per_tick` per tick, the same rate limit that governs ordinary
in-call modulation. Crossing a call-state boundary is a different kind of
event: a real, structural shift in where conditioned air is going system-
wide, all landing in a single tick. Creeping through that change at the
everyday rate leaves the system under-adjusted — either restricting
airflow to newly-demanding zones or holding pressure against newly-
satisfied ones — for however many ticks the ordinary ramp takes to catch
up, and raises exactly the static-pressure risk this whole line of work
started from.

The natural-sounding fix — stagger the response by zone priority, closing
lower-priority zones first — turned out to be unnecessary. The existing
pressure-floor clamp (`pressureSafeguard.ts`) already reopens
highest-priority zones first whenever the floor binds, and that logic sits
downstream of ramp untouched. Applying one uniformly larger step size to
every zone inside the ordinary Step 2 loop and leaving the floor clamp
alone produces the priority-aware staggering for free — see the "relies on
the existing pressure-floor clamp" test in `pipeline.test.ts`. No
per-zone classification (demanding vs. satisfied) was needed either: zones
that don't reach the Step 2 loop at all (manual override, `no_vent`,
inactive) are already excluded from ramp, so the wider step only ever
applies where ramp already applies.

A related question was whether to exempt sleep-mode zones, preserving
today's quiet-hours behavior. The instinct was backwards: a 50%-in-one-tick
motor move and a 10%-in-one-tick move both fire the vent motor once, and
what actually drives noise and risk is fewer, larger moves versus a longer
sequence of smaller ones that also has a higher chance of a stuck mid-creep
vent needing a full, loud open/close recalibration cycle. Sleep-mode zones
are deliberately included, uniformly, via the same unmodified Step 2 loop.

## Decision

New settings `fast_transition_enabled` (bool, default `false`) and
`fast_transition_step_pct` (percent, default `50`, PLACEHOLDER pending
real-world tuning) govern a widened `maxStepsPerTick` — not
`modulationStepPct` — applied for exactly one tick: the tick on which
`computeZoneCommands`'s new `previousState` parameter shows `callActive`
flipped (`COOLING_CALL`/`HEATING_CALL` on one side, anything else on the
other). Widening `maxStepsPerTick` rather than `modulationStepPct` was
deliberate: the latter would coarsen the quantization grid itself
(`discrete_position_step_pct`/`modulation_step_pct`) for that tick, while
raising the step count keeps every landed position on the same grid it
always uses, just reachable faster.

`fast_transition_step_pct` is expressed as a percentage, mirroring
`dead_zone_recovery_jump_pct`, rather than as a raw step count, for the
same reason: it stays independent of whatever grid is configured.
`effectiveMaxStepsPerTick` is `max(maxStepsPerTick,
ceil(fastTransitionStepPct / effectivePositionStepPct))` so it only ever
widens the allowance, never narrows it below the ordinary configured rate.

`previousState` defaults to absent (`tick.ts` passes
`priorRuntime.lastHvacState`), and the mechanism is inert whenever it's
`null`/`undefined` (first tick ever) or unchanged from `state` — a
same-state tick never qualifies, regardless of what caused the tick to
run.

The pre-existing dead-zone-recovery jump (`step2Ramp.ts`) is checked first
and takes precedence when a zone's `lastCommandedTarget` sits at an exact
0/100 matching `deadZoneRecoveryDirection`, exactly as it did before this
change — fast transition only affects the ordinary step-limited ramp
branch, and its own fallback computation for
`deadZoneRecoveryJumpPct` continues to use the ordinary
`maxStepsPerTick`, unaffected by whether fast transition is active that
tick.

## Consequences

Defaults to `false`: this ships fully reversible, opt-in only,
per the same "we don't yet know if this is the behavior we ultimately
want, but need to be able to test it and back out via configuration"
reasoning that shaped ADR-0006's idle-baseline widening. No new per-zone
override — the mechanism is a system-wide tick-shape behavior, not a
per-zone comfort tuning — so it lives only in `system_settings`, wired
into the settings UI (`systemParameterFields.ts`) under the advanced tier
alongside `max_steps_per_tick`.
