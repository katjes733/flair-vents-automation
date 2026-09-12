# Recommendation Engine Candidates

- [Recommendation Engine Candidates](#recommendation-engine-candidates)
  - [Purpose](#purpose)
  - [How to add an entry](#how-to-add-an-entry)
  - [Candidates](#candidates)
    - [1. Zone permanently open at idle baseline while already at target](#1-zone-permanently-open-at-idle-baseline-while-already-at-target)

## Purpose

A running list of data-driven tuning opportunities discovered through real investigation of this app's own production telemetry (Loki tick-decision history, mostly) — each one is a candidate signal/recommendation pair for a future automated recommendation system that would surface these to a user proactively, instead of requiring a manual investigation like the ones that found them here.

This system itself doesn't exist yet — it's a deferred feature. This doc exists so the analysis behind each candidate isn't lost between now and whenever it gets built, and so new candidates can be added the same way as they're found, one per real issue investigated.

## How to add an entry

Each candidate should include:

- **Signal** — what pattern in the tick-decision history (or other stored data) would trigger this recommendation, precisely enough that a future engine could actually detect it.
- **Recommendation** — what the system would suggest, in user-facing terms.
- **How discovered** — the real investigation that surfaced it (date, air handler/zone, what the data showed). This is what makes the signal trustworthy later instead of speculative.
- **Status** — whether it's just an observed pattern, or something that's already been manually applied once (and where).

## Candidates

### 1. Zone permanently open at idle baseline while already at target

- **Signal**: a `flair_smart_vent` zone whose classification is `satisfied` for most of a rolling window (e.g. 24h), and whose commanded position sits at (or within a small margin of) its own `idle_baseline_position` for nearly all of that time. Concretely: the zone's `overshoot` term in the closing ramp (`step1DesiredPosition.ts`) rarely or never exceeds 0 — it holds comfortably at target but never overshoots *past* its tolerance band, so the ramp never has a reason to close it further than its idle baseline.
- **Recommendation**: "Zone X has rested at its idle baseline (Y%) for Z% of the last N days without ever needing to close further. Consider lowering `idle_baseline_position` — it's occupying duct capacity other zones could use, without ever actually needing that much airflow to stay comfortable." Could be sharpened by cross-referencing which *other* zones were simultaneously struggling (the same `otherZoneStruggling` signal capacity sharing already computes) to prioritize which reductions would have the most impact.
- **How discovered**: 2026-09-11, investigating why "Upstairs" ran at 190%+ of rated blower capacity on every sample across a full day. Traced to "Den Front" sitting at exactly its 100% `idle_baseline_position` continuously — its own temperature hovered right at its 72°F setpoint (71.7–74°F) all day, so the closing ramp's overshoot-only trigger never engaged. This is also what causes the demanding-side ramp to collapse to a flat 100% with zero gradation whenever `idle_baseline_position == max_vent_position` (the schema default for both) — a second, related effect of the same untouched-default problem.
- **Status**: manually diagnosed and applied — "Den Front," "Luke Bedroom," and "Martin Bedroom" `idle_baseline_position` lowered from the 100% default to 25% on 2026-09-11 on the "Upstairs" air handler, pending a follow-up real-data check that the two bedrooms don't run warmer than desired under the new, lower ceiling.
