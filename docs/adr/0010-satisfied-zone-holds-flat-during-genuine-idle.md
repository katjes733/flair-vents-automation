# A satisfied zone holds flat at the no-call baseline during genuine idle

Raised while reviewing the live dashboard: a satisfied, unoccupied zone
(Den Front) sat at 40% while the system was IDLE, not at its configured
`no_call_active_baseline_position` (50%). Tracing it down surfaced a real
gap [[idle-baseline-reuse-for-genuine-idle]] (ADR-0006) left unaddressed.

`computeDesiredPosition`'s satisfied branch has always closed a zone
further the more it's overshot its comfort tolerance, running from
`idleBaselinePosition` (at zero overshoot) down to `min_vent_position`
(at or past a full proportional band of overshoot) — see that branch's
own comment. ADR-0006 changed *which value* feeds `idleBaselinePosition`
depending on `callActive` (`satisfied_baseline_position` vs
`no_call_active_baseline_position`), but never touched *whether* this
proportional-closing behavior itself should apply. So a genuinely idle,
satisfied zone still closed further with more overshoot, exactly as it
would while a sibling was actively being conditioned.

That's wrong on its own terms: the closing curve's entire justification
is *"every percent open is real conditioned air diverted from a zone that
needs it right now"* — true only while `callActive`. During genuine idle
there's nothing being conditioned, so there's nothing to divert, and
closing further actively works against `no_call_active_baseline_position`'s
own purpose (standing pressure headroom for whenever the next call
starts) — the same problem the fast-transition work
([[fast-transition-on-call-start-end]], ADR-0007) exists to reduce from
the other direction.

## Decision

`computeDesiredPosition` takes a new `callActive: boolean`. In the
satisfied (`!demanding`) branch, `!callActive` now returns
`idleBaselinePosition` directly — flat, regardless of overshoot — before
the proportional-closing math ever runs. The demanding branch is
completely untouched: a zone still classified demanding during genuine
idle (the arbitrary cooling-direction default) ramps exactly as it would
during an active call, unaffected by this change, since the safety-net
reasoning for demanding never depended on `callActive` in the first
place.

This only changes Step 1's *raw target* for a satisfied, genuinely-idle
zone. Step 2 (`rampTowardTarget`) still rate-limits the actual commanded
movement per tick regardless of how far the raw target jumps — so a call
ending doesn't snap a zone straight to its no-call baseline in one tick;
it takes the same bounded, ordinary step (or the deliberately wider
fast-transition step, if enabled) any other target change would. This
matters for a real, previously-fixed incident: a short-cycling system
that rapidly toggles between an active call and IDLE would, without this
rate limit, reopen and re-close a zone in full on every cycle — Step 2
already prevents that regardless of what Step 1 computes, so this change
doesn't reintroduce it. It does mean a zone brought to rest during a call
will drift, one ordinary step at a time, toward the (now-legitimately
different) no-call baseline if the system dwells in IDLE for more than a
tick or two — a real, visible-but-bounded behavior change, not the old
instant-reopen bug.

## Consequences

A satisfied zone's position now genuinely differs between "satisfied
while a sibling is active" and "satisfied during genuine idle" whenever
those two settings differ and there's real overshoot — previously they
only differed by the flat baseline value at zero overshoot. One
regression test (`tick.test.ts`) had never actually threaded persisted
zone state between its two manually-orchestrated tick calls (a
pre-existing gap in that one test, not a systemic issue — every other
multi-tick test in the file does this correctly via `state:
persisted.get(...)`), which pre-fix coincidentally produced matching raw
targets across both calls and made the gap invisible; fixed alongside
this change, and its assertion updated to check the correct bounded,
single-step behavior instead of exact position equality.

No new setting, no migration — this is a formula-level fix to how
`no_call_active_baseline_position`/`satisfied_baseline_position` were
already being consumed, not a new config surface.
