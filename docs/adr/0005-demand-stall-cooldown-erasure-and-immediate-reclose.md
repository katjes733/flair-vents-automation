# Demand stall: cooldown survives idle gaps, in-progress cycles aren't abandoned, and reclose is immediate

Diagnosed from production Loki tick-decision logs after Martin Office's own
vent position and temperature charts showed a persistent "erratic," full-
amplitude sawtooth all day — not the smooth ramp-up/plateau/ramp-down a
proportional controller should produce. The dashboard's own "Vent
Misalignment" panel was a red herring: across the visible ~30h window it
fired only 5 times, all within a ~75-minute stretch, mostly the zone
owner's own manual "Unstick vent" tests.

The real, dominant cause: `demand_stall_detection_enabled` — a sibling
force-open mechanism to vent misalignment (`evaluateDemandStall`,
`demandStall.ts`) — fired **18 times across the same ~30h window**, as
close together as 36 minutes and averaging one every ~95 minutes. Every
occurrence forced the vent straight to 100% regardless of what the
ordinary control loop had computed that tick, confirmed directly in the
tick-decision logs (e.g. one tick's own math produced a commanded 50%,
but the vent was actually commanded 100% that same tick).

`demand_stall_recalibration_cooldown_hours` was configured at 4 hours —
yet real episodes recurred as often as every 36 minutes. Root cause,
found by tracing the persisted `demand_stall_last_recalibrated_at` value
across ticks: `evaluateDemandStall`'s own `!trackingActive` branch (fires
the instant the zone stops being simultaneously `demanding` and under an
active call — which happens as part of this zone's *ordinary* cycling,
roughly every 15–20 minutes) returned the raw `EMPTY_DEMAND_STALL_STATE`
unconditionally, which zeroes `lastRecalibratedAtMs` along with
everything else. Since the cooldown is keyed on that field
(`inCooldown = prior.lastRecalibratedAtMs !== null && ...`), it got erased
almost immediately after every single completed cycle — the configured
4-hour cooldown was **never actually in effect** in practice, since the
very next ordinary demanding→satisfied transition wiped it before it
could block anything.

`evaluateVentMisalignment` already gets this right (explicitly preserves
`lastRecalibratedAtMs` through its own equivalent reset — see its own
comment); `evaluateDemandStall` was never given the same treatment.

A second, related divergence from vent misalignment's design: demand
stall checked `trackingActive` *before* checking whether a force-open
cycle was already in progress, the reverse of vent misalignment's own
ordering. Forcing a vent open is exactly what's expected to make a room
start improving — which can flip classification away from `demanding`
mid-cycle — so checking `trackingActive` first abandoned an in-progress
cycle (and silently dropped `stalledSinceMs`/`lastRecalibratedAtMs` with
it) the instant it started working, rather than letting it run to
completion the way vent misalignment's own comment already establishes
("an in-progress home cycle isn't tied to the call still being active").

Finally, demand stall's `recalibration_finished` branch (`tick.ts`) never
received the "immediate reclose" fix vent misalignment got (ADR-0004's
own update): it left `pipelineResult.commandedPositions[zone.id]` in
place, which is already rate-limited by `rampTowardTarget` against a
`last_target_position` anchor that had been pinned at the forced-open
extreme for the whole cycle just finished — reproducing the identical
slow, one-`modulation_step_pct`-at-a-time ramp-down bug on a feature that
fires roughly 18x more often than vent misalignment does.

## Decision

Three fixes, all mirroring patterns vent misalignment's own design
already established:

1. **Preserve `lastRecalibratedAtMs` through the `!trackingActive`
   reset** — `stalledSinceMs` is still cleared (a zone no longer
   demanding at all isn't a driving-zone eligibility candidate anyway),
   but the cooldown gate itself survives an ordinary idle/satisfied gap,
   so `cooldownMs` actually gates re-triggering across real time instead
   of resetting on the next classification flip.
2. **Check for an in-progress cycle before `trackingActive`** — an
   already-running force-open runs to completion regardless of whether
   classification or call-active state changes mid-cycle, same guarantee
   vent misalignment already provides.
3. **Immediate reclose** — `recalibration_finished` now snaps
   `finalPositions[zone.id]` to `pipelineResult.rawDesiredPositions[zone.id]`
   (the zone's true, unramped target this tick — see ADR-0004's update
   for why `commandedPositions` itself isn't safe to use here) instead of
   leaving the ramped, anchor-poisoned value in place.

Deliberately *not* changed: `demand_stall_detection_minutes` (12) and
`demand_stall_temp_threshold_c` (0.56°C) themselves. Martin Office's own
`distant_high_duct_loss`/`high_internal_heat_load` thermal-load flags
mean it's already known to be a harder, slower zone to cool than its
siblings, and these thresholds are global — it's plausible they're still
too aggressive for this specific zone even with a correctly-functioning
cooldown. That's a separate, follow-up tuning question once the cooldown
itself is verified to actually hold in production; conflating a real
logic bug with a threshold-tuning judgment call in the same change would
make it harder to tell which one actually fixed the observed behavior.
