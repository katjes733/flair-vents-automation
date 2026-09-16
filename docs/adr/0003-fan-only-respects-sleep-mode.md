# FAN_ONLY falls through to the anchor-aware path during Sleep Mode

Diagnosed from production Loki tick-decision logs and Postgres config after
a real overnight incident: both bedroom zones' vents cycled open toward
~90–100% and back to 0% ten separate times over one night (roughly every
45–90 minutes, several clustered between 2am and 6am), producing 79–84
genuine motor-moving dispatches per zone over the 10-hour window — not
background noise, felt/audible movement that disrupted sleep. Both zones
stayed correctly classified `satisfied` almost the entire night; this
wasn't classification hysteresis flapping. Each cycle's start and end
aligned exactly with the HVAC system entering and leaving `FAN_ONLY` (ten
`FAN_ONLY` segments overnight, 3–5 minutes each) — normal blower-only
stretches between compressor cycles, not a fault condition.

Root cause: `computeZoneCommands`'s `FAN_ONLY` branch (`pipeline.ts`,
originally added so a genuinely unconditioned circulation cycle rests every
zone at its own `fanOnlyIdleBaselinePosition`, default 100%, rather than
running deviation math against unconditioned air) `continue`s before
`sleep_quiet_anchor`'s own logic — which lives later in the same
function — ever runs. So a satisfied bedroom zone in an active Sleep Mode
window got forced open toward 100% on every `FAN_ONLY` entry regardless of
`sleep_quiet_anchor_enabled`, then ramped back down once `FAN_ONLY` ended —
the anchor wasn't overridden by anything, it was structurally unreachable
for that state. This mirrors an already-fixed, nearly identical gap for
plain `IDLE` (see that fix's own comment in `pipeline.ts`): a satisfied
zone used to get shoved back to `idle_baseline_position` every time the
compressor cycled off, fixed by folding `IDLE` into the same proportional
math an active call runs. That fix was never extended to `FAN_ONLY`.

The dead-zone-recovery jump (`dead_zone_recovery_jump_pct`/`_direction`,
ADR-0002), deployed the same evening this was noticed, is a real but
secondary amplifier, not the root cause: every `FAN_ONLY`-driven climb
started from exactly 0% (the global `comfort_idle_baseline_position`
default, no per-zone override for either bedroom), and jumping straight to
50% on that first move — working exactly as designed — made an
already-undesirable cycle noticeably more abrupt at its start than a plain
first 10% step would have been. Fixing the root cause below also
eliminates most of these jump triggers, since a Sleep-Mode zone no longer
gets driven all the way down to 0% between cycles in the first place.

## Decision

A zone with an active Sleep Mode window (`zone.sleepModeActive`) skips the
`FAN_ONLY`-specific branch entirely and falls through to the same
anchor-aware path `IDLE` already uses — `FAN_ONLY` becomes just another
idle gap for that zone, not its own separate open-for-circulation state.
Checked directly against `sleepModeActive`, not gated behind
`sleep_quiet_anchor_enabled`: even without the anchor's own extra hold,
ramping smoothly toward the comfort floor beats being forced open, exactly
as already established for `IDLE`. Outside Sleep Mode, `FAN_ONLY`'s
original whole-house-circulation behavior is unchanged — a real, accepted
trade-off: a sleeping room's own quiet, comfort-focused resting position
outweighs house-wide circulation during Sleep Mode specifically, not
generally.
