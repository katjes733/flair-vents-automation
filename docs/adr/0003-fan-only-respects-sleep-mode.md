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

## Update: Sleep Mode zones were never circulating at all during FAN_ONLY

The original decision above over-corrected. Routing a Sleep-Mode zone
through the same path `IDLE` uses meant it anchored to the *comfort*
curve's own output (`computeDesiredPosition`, trending toward
`min_vent_position` the longer a zone stays satisfied) for a genuine
FAN_ONLY stretch too — so the yanked-open-every-cycle problem was fixed,
but the zone stopped circulating air during FAN_ONLY at all, just held
closed. The intent was never "a sleeping room shouldn't circulate," only
"a sleeping room shouldn't be jolted by it" — confirmed directly with the
person sleeping in the room: sleep zones should fully circulate, just
quietly.

**Decision.** `pipeline.ts`'s anchor logic now tracks *why* a non-demanding
Sleep-Mode zone reached it: `inFanOnlyDuringSleep` (true only while
`!callActive && state === "FAN_ONLY" && !isDemanding && zone.sleepModeActive`)
switches the anchor's target from the comfort curve to the same
`fanOnlyIdleBaselinePosition`-derived value the ordinary (non-sleep)
FAN_ONLY branch already computes — still held flat for the same
anti-noise reason, just circulating instead of closed. Demanding is
untouched either way, per the original decision's own safety-net
reasoning.

This target-selection applies *regardless of* `sleep_quiet_anchor_enabled`,
mirroring the original decision's own precedent (the FAN_ONLY-routing
choice above isn't gated on it either) — the freeze is an optional
refinement on top of "which target," not a precondition for circulating
at all.

A real FAN_ONLY stretch is typically only a few minutes — far shorter than
`sleep_quiet_reanchor_interval_minutes` (default 60) — so the existing
interval-based reanchor alone would almost never fire during one, leaving
a zone stuck holding whichever target it last anchored to under the
*other* mode for the entire window. A new persisted field,
`sleep_quiet_anchor_is_fan_only` (mirrors `sleep_quiet_anchor_position`/
`_since`'s own shape), tracks which mode produced the currently-held
anchor and forces an immediate reanchor the instant it no longer matches
the current tick's mode — entering or leaving FAN_ONLY reanchors right
away, in either direction. An anchor already in progress from before this
fix shipped carries no persisted value for this new field (`null`) — that
is deliberately treated as "unknown, don't force a reanchor," not as "the
mode differs," so upgrading doesn't force every currently-anchored zone to
jump on its very next tick regardless of whether anything actually
changed.

**Related, smaller decision made alongside this one:** `fan_only_idle_baseline_position`'s
own default dropped from 100 to 50 (see its own comment,
systemSettings.ts). Real house-wide circulation doesn't need every vent
maxed — especially with several zones opening at once — and reaching 100
from wherever a vent sits is a larger, louder motor sweep than reaching a
partial value, which now matters directly here: a Sleep-Mode zone
circulating through this same baseline should do so quietly, not with a
full-range sweep that reintroduces the very noise this ADR exists to
prevent.

## Update (ADR-0009)

`fan_only_idle_baseline_position` — referenced throughout this decision
under its name at the time — was renamed to `no_call_active_baseline_position`
once its name was flagged as misleading (it had, since ADR-0006, widened
to cover genuine IDLE too, not just FAN_ONLY). See
[[rename-fan-only-idle-baseline-and-minimum-comfort-tolerance]] (ADR-0009);
the decision recorded above is otherwise unchanged.
