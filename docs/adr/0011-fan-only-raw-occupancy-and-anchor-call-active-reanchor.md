# FAN_ONLY uses raw occupancy; sleep anchor reanchors on a callActive flip

Two related gaps found live, both surfacing from the same root cause:
[[satisfied-zone-holds-flat-during-genuine-idle]] (ADR-0010) made a
satisfied zone's raw target depend on `callActive`, introducing a new
dimension that two existing mechanisms — the FAN_ONLY occupancy check and
the sleep-mode quiet anchor — hadn't been built to account for.

## FAN_ONLY's occupancy check needs the raw signal, not the trusted one

Diagnosed live: Martin Office, genuinely occupied, sat at 30% during a
FAN_ONLY stretch instead of its 50% no-call baseline. Traced through
production Loki history and the deployed source directly (confirmed via
`docker exec` against the live worker container, not just local
reasoning): `PipelineZoneInput.occupied` carries a _trusted_ signal that
discounts a continuously-true occupied reading once it's been sustained
past `occupancy_trust_window_minutes` (30 min default — sourced from
Flair's own documentation that Ecobee SmartSensors report "occupied" for
30 minutes after last real motion). That discount exists for one specific
reason (its own comment): stop a stuck-on sensor from indefinitely
protecting an empty room from closing at a demanding sibling's expense
during an active call — a real, confirmed incident.

FAN_ONLY's own occupancy check serves a completely different purpose:
prioritizing airflow to a room that's actually occupied, with no scarcity
concern at all (nothing is being conditioned during FAN_ONLY). The trust
window's rationale doesn't apply here — a person who's been sitting in an
office for 45 minutes hasn't become less present, but the discounted
signal was treating them that way, silently reducing their airflow
priority as if the room were probably empty.

**Decision.** Added `rawOccupied` alongside the existing (trusted)
`occupied` on `PipelineZoneInput`, sourced from the same underlying
hysteresis signal `occupied`'s own displayed dashboard value already uses
(`occupiedByZone`, not `trustedOccupiedByZone`). Every occupancy check
tied to _protecting from closing during an active call_
(`computeDesiredPosition`'s occupancy boost, Step 3's contention bucket)
keeps using trusted `occupied`, unchanged. Every occupancy check tied to
_FAN_ONLY circulation priority_ (the ordinary FAN_ONLY branch, and the
FAN_ONLY-during-Sleep-Mode anchor target) now uses `rawOccupied` instead.
The two branches that can fire during _either_ an active call or genuine
idle/FAN_ONLY (`staleReading`'s and `unclassified_no_sensor`'s own
`effectiveIdleBaseline` calls) resolve conditionally:
`callActive ? occupied : rawOccupied` — trusted while there's scarcity to
protect against, raw while there isn't.

The dashboard's own displayed `occupied` field is unaffected — it already
showed the raw signal, deliberately, to keep agreeing with what Ecobee's
own app reports. This fix makes the _position math_ agree with what the
dashboard already shows, for the FAN_ONLY case specifically, instead of
the two silently diverging after 30 minutes of continuous occupancy.

## The sleep-mode quiet anchor needs to reanchor on a callActive flip

A second, related gap the same live investigation surfaced: a Sleep-Mode
zone (Martin Bedroom, Luke Bedroom) that became satisfied mid-call
captured its quiet anchor from the _in-call_ target
(`satisfied_baseline_position`-anchored, defaulting to 0). Once the call
ended, ADR-0010 changed what the _live_ target would be
(`no_call_active_baseline_position`, e.g. 50) — but the anchor's own
reanchor trigger only knew about two conditions: the refresh interval
elapsing, or `anchorIsFanOnly` changing (entering/leaving FAN_ONLY). A
plain `callActive` flip (a call ending into genuine IDLE) matches neither
— `inFanOnlyDuringSleep` is `false` on both sides of that transition — so
the anchor stayed pinned to its stale in-call value for up to the full
`reanchorIntervalMinutes` (60 min default), never picking up the no-call
baseline's own standing-headroom benefit ADR-0010 exists to provide.

**Decision.** Added `sleep_quiet_anchor_was_call_active` (persisted
runtime state) and `priorAnchorWasCallActive`/`wasCallActive` (pipeline
input/output), mirroring `sleep_quiet_anchor_is_fan_only`'s exact shape
and its own backward-compatibility convention: `null` (an anchor already
in progress from before this fix shipped) never forces a reanchor on its
own, only an explicit mismatch between the anchor's recorded
`wasCallActive` and the current tick's `callActive` does.

## Consequences

Both fixes are pure corrections to existing, already-deployed mechanisms
— no new settings, no config change, no migration. `bun run
tsc`/`test`/`verify` all pass (1806 tests). Diagnosed and verified end to
end against real production data and the actual deployed source (SSH into
the NAS, `docker exec` into the worker container) rather than local
reasoning alone, given how much today's earlier explanations turned out
to be wrong before being checked against the real system.
