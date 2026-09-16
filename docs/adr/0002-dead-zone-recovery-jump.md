# Dead-zone recovery: jump past vent stiction instead of calibrating it

Real hardware observation: a Flair smart vent resting at a hard physical
extreme (0% or fully closed, 100% or fully open) can sit fully unresponsive
to an ordinary `modulation_step_pct`-sized command (default 10%) for a
stretch immediately after starting to move the other way — confirmed in
both directions (opening from closed, closing from open) — before the
motor visibly moves at all. Critically, the width of that unresponsive
stretch is not consistent from one occasion to the next; there's no single
number that reliably describes it.

Because `computeZoneCommands` computes exactly one target position per
zone (`commandedPositions[zone.id]`) that every vent in the zone ramps
toward identically, and dispatch fan-out to individual vents already
handles any per-vent divergence at the dispatch layer (step-delta
suppression), this is a zone-level ramp concern, not a per-vent one. A
zone that genuinely needs per-vent-granular handling already has the tool
for that: split it into separate zones.

We deliberately did not try to calibrate an exact deadzone width. Instead,
`rampTowardTarget` (`step2Ramp.ts`) jumps straight to a configured
`deadZoneRecoveryJumpPct` (global `dead_zone_recovery_jump_pct`, default
50%, overridable per zone) the one tick a zone's `lastCommandedTarget` is
sitting at 0% or 100% and the newly computed target calls for movement the
other way — comfortably past anything observed — then resumes the
ordinary step-capped ramp from that new origin on every subsequent tick,
in whichever direction is actually needed. This deliberately overshoots or
undershoots the real target when the jump lands past it; that's accepted,
since the very next tick's ordinary ramp corrects it like any other ramp
step, and it needs no extra retry/tracking state of its own — once the
origin is no longer 0 or 100, the mechanism naturally stops applying.

`dead_zone_recovery_jump_pct` set to `null` (an explicit global clear, not
its default) falls back to an ordinary max-size step
(`modulation_step_pct * max_steps_per_tick`, or `discrete_position_step_pct`
in its place) — functionally identical to not having this feature at all,
so there's no separate on/off flag.
