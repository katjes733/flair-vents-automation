# Vent misalignment: immediate reclose, no long cooldown, chronic escalation, manual trigger

Real incident, diagnosed from production Loki/Postgres data: a bedroom
stayed 3–5°F below setpoint for hours during the day. The existing
vent-misalignment auto-recalibration feature had already detected and
"fixed" this exact zone repeatedly — 9 recorded cycles across 3 zones on
one air handler over 2.5 days, every single one completing with outcome
`"opened"` (the vent's motor visibly moves when commanded) — yet the room
kept needing another cycle every ~4 hours, bounded almost exactly by
`vent_misalignment_recalibration_cooldown_hours`. `vent_misalignment_alert_enabled`
was off, so none of this ever reached anyone. Two further, independent
problems compounded it:

1. **The reclose itself was slow.** `evaluateVentMisalignment`'s
   `recalibration_finished` action force-opened the vent to 100%, but the
   code never released that override back to the pipeline's own computed
   target — so the *next* tick's ordinary ramp treated 100 as its new
   origin and walked back down 10%/tick, holding the vent substantially
   open for ~10 more minutes after every cycle, actively cooling an
   already-overcooled room.
2. **The cooldown discarded all memory of the problem.** A vent that
   visibly opens when commanded proves the motor works, not that it
   *seals* when reclosed — `percent-open` is an accumulated estimate, not
   a position sensor, so a physical sealing defect (warped/dirty damper,
   a duct leak near the vent) can't be distinguished from a one-off
   estimate drift by this check alone. Recalibrating once, then going
   completely silent for the cooldown's full duration regardless of
   outcome, meant a genuinely broken vent got "fixed" over and over
   without anyone — human or system — ever noticing the pattern.

## Decisions

**Immediate reclose.** On `recalibration_finished`, the control tick
snaps the commanded position straight to what the pipeline already
computed naturally that same tick (its real target, e.g. 0% for a
satisfied, closed zone) instead of leaving the forced-100 override for
the ordinary ramp to unwind. Force-open, confirm, reclose — no scenic
route.

**Cooldown replaced with a short debounce, backed by chronic escalation
instead of silence.** `vent_misalignment_recalibration_cooldown_hours`
(default 24h) is gone; `vent_misalignment_recalibration_debounce_minutes`
(default 3) exists only to let the just-reclosed vent's reading settle
before detection can re-open a window — not to stop watching. What
actually protects against endlessly re-cycling a persistently-faulty vent
is new: `vent_misalignment_chronic_threshold_count`/`_window_hours`
(default 3 within 2h) — a zone crossing that threshold is flagged
"chronic," shown as a warning chip in the dashboard, and always emailed
(deliberately independent of `vent_misalignment_alert_enabled`, which
only gates the routine per-occurrence notice). A chronic zone keeps being
commanded normally — there is no way yet for a person to lock a zone out
or fix a physical vent remotely, so degrading its control would only make
comfort worse with no compensating benefit. The badge only clears when a
person manually acknowledges it (there's no automatic "the vent is
physically fixed now" check to run), by clearing the zone's own
recalibration history — the entire input `isChronicallyMisaligned` reads,
so there's nothing else to keep in sync.

**A manual trigger exists for maintenance verification**, entered through
the same `evaluateVentMisalignment` state machine as the automatic
detector (`recalibrationTrigger: "auto" | "manual"` distinguishes them in
logs/history) but bypassing the debounce and tracking-window/temp-threshold
conditions entirely — a deliberate, explicit action shouldn't have to
first prove itself suspicious. It's excluded from the chronic-escalation
history on purpose: a maintenance check someone runs by hand isn't
evidence of anything by itself, only repeated *automatic* detections are.
Gated admin-only (`dashboard.zone.ventRecalibration.{trigger,clearWarning}`),
unlike every sibling `dashboard.zone.*` action available to any write
profile — this forces a real, physical vent movement.

## Consequences

The manual-trigger endpoint refuses to run (400) unless
`vent_misalignment_auto_recalibration_enabled` is already on — it invokes
the same mechanism the automatic feature does, not an independent one,
so there's no code path that starts a "recalibration" cycle while that
mechanism is otherwise fully disabled. The confirm dialog for the manual
trigger says explicitly that a successful cycle only proves the motor
responds, not that the underlying leak is fixed — the same false-confidence
gap the automatic detector's own history exposed, now made explicit for a
human pressing the button too.

## Update: force-open target is direction-aware, and the manual request needs its own UI feedback

Live click-through on the real Martin Office zone surfaced two gaps this
ADR's original design didn't anticipate.

**The force-open target was hardcoded to 100%,** regardless of the vent's
own position when the cycle started. A vent already sitting at 80% got
nudged the remaining 20 points to 100% instead of the decisive full-range
movement the mechanism is meant to perform; the user's own stated
expectation (confirmed as the correct spec) is that an 80% vent should
flip to 0% and back, a 20% vent to 100% and back — whichever extreme is
*farther* from wherever the vent currently sits, not always the same one.
Fixed by adding `targetExtremePct` (0 or 100) to `VentMisalignmentState`,
chosen once when a cycle starts via `farthestExtremeFrom(currentPositionPct)`
and held fixed for that cycle's whole open-wait, with the completion check
(`isNearExtreme`) generalized to whichever extreme the cycle is actually
forcing toward rather than always checking for "reported open." A cycle
already in flight from before this fix shipped carries no persisted
`targetExtremePct` at all; it defaults to 100 (the old build's own
hardcoded behavior) rather than losing track of the in-flight cycle.

**The dashboard didn't reflect a manual request until the next tick
picked it up.** `vent_manual_recalibration_requested_at` is set
server-side the instant a person confirms the trigger dialog, but the
progress indicator and disabled button were keyed only on
`vent_misalignment_recalibrating_since`, which stays null until the tick
loop actually starts the cycle — up to one control-tick interval later.
The confirm dialog's own immediate post-submit refetch (`onChanged`)
already pulls the updated `vent_manual_recalibration_requested_at`
instantly; the dashboard just wasn't reading it. `ZoneCard` now treats
"request recorded but not yet ticked" as its own pending sub-state (a
distinct "waiting for the next control tick" label), so the button
disables and the progress indicator appears the moment the request is
confirmed, not once a tick happens to land.

Both are treated as amendments to this same decision, not new ones: same
mechanisms (force-open/wait cycle, manual trigger), just discovered to
need a direction and an earlier UI signal than first shipped.
