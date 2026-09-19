# Equipment-fault detection: thermal-load leniency and vent-open dwell

Four related fixes to `detectEquipmentFault`/`detectDuctAirflowAnomaly`,
shipped across the same investigation as it widened: an initial 48-hour
window (5 triggers) grew into a full 30-day audit (21 triggers) once the
first two fixes below turned out not to explain most of them. Every
trigger examined shared the same shape — a logged differential sitting
suspiciously close under the flat 5.56°C threshold, self-clearing within
minutes — with no other evidence of an actual equipment problem. The first
three fixes narrow _which readings the check trusts_; the fourth accepts
that the check will still sometimes be wrong about a single tick, and
changes _how long it has to keep being wrong_ before acting on it.

## Zones with thermal load flags have a structurally smaller true differential

Martin Office is flagged both `distant_high_duct_loss` and
`high_internal_heat_load` (confirmed via direct DB query); Luke Bedroom is
flagged with neither. These flags already exist and already narrow the
effective comfort band in Step 1's position math, but fault detection had
zero awareness of them — confirmed via code review that `DuctReadingZone`
carried no such field and both detection functions applied one global
threshold to every zone regardless of flags.

A zone that's genuinely far from the air handler or running a high internal
heat load will show a smaller true duct-to-room differential even when the
equipment is working perfectly — the same physical cause the flags already
exist to describe, just never connected to this specific check before.

**Decision.** Added `thermal_load_flags` to `DuctReadingZone` and a new
setting, `equipment_fault_thermal_load_leniency_c` (default 1.0°C),
subtracted from `equipment_fault_duct_delta_threshold_c` only for zones
carrying at least one thermal load flag. Applied identically in both
`detectEquipmentFault` (whole-system) and `detectDuctAirflowAnomaly`
(per-zone), since both share the same `usableZones`/threshold-comparison
shape.

## A vent that just crossed the open floor hasn't earned a representative reading yet

Luke Bedroom's one real outlier trigger had a different mechanism: tracing
its tick history, the vent was actively ramping closed (70% → 20%) as the
room approached its own comfort target, and sat exactly at the
`equipment_fault_min_vent_open_pct` floor (20%) at the moment of the fault
check — not comfortably above it. A vent that's barely open, or that just
crossed the floor a tick ago, gives the passing air more time to mix with
duct/room-ambient temperature before reaching the sensor, producing a
smaller, less representative reading even under a fully healthy call —
distinct from Martin Office's structural explanation, but the same class of
problem: the detector doesn't discriminate a borderline reading from a
trustworthy one.

**Decision.** Added a new setting, `equipment_fault_vent_open_dwell_minutes`
(default 2 minutes), and a `ventOpenDwellSatisfied` field on
`DuctReadingZone` — a vent must have sat continuously at/above
`equipment_fault_min_vent_open_pct` for at least this long before its duct
reading counts as "usable," the same way a stale or missing reading already
doesn't. Tracked per-vent (keyed by the existing `reconciliationKey(zoneId,
ventId)`) in `ZoneDemandTrackingStore`'s Redis-backed ephemeral state,
mirroring `ductAnomalySinceMs`'s exact shape: reset to `null` the instant
the vent drops below the floor, so a vent that closes and reopens has to
re-earn its dwell each time.

Computed once per tick, in Step 5 (before the position pipeline runs, using
the same pre-pipeline last-reported-position proxy `ductZones` already
relies on) and reused verbatim by the later per-zone anomaly check — not
recomputed against the pipeline's post-decision commanded position, which
would silently overwrite the same Redis record with an inconsistent value
mid-tick.

In production this shouldn't meaningfully delay real fault detection: the
existing 10-minute grace period (before the check even starts looking) and
trigger dwell (before a failing tick is actually declared a fault, raised
to 15 minutes below) already give a normally-behaving call's vents far more
than 2 minutes to settle open. The dwell requirement only bites the
specific case a vent is right at the edge of usable — freshly opened, or
actively transiting through the floor — which is exactly the false-positive
it targets.

## The room-temperature side of the check has never had a staleness check

Widening the investigation to a full 30 days turned up 21 triggers, not 5 —
and neither of the two fixes above explained most of them. Den Front,
Martin Bedroom, and Luke Bedroom all carry no thermal load flags and were
comfortably past any vent-open-dwell concern, yet still triggered
repeatedly. Tracing the actual room-temperature values logged per tick
across all 21 episodes (using "how long has this exact value repeated" as
a proxy, since no real timestamp was ever captured) found the room reading
had been frozen — unchanged for 11-20 minutes — in several of them,
including one 20-minute case comfortably over `stale_threshold_minutes`.

The duct-temperature side of the check has always excluded a stale
reading (`ductReadingStale`, existing since before this ADR). The
room-temperature side never did, on either data path: `FlairRoom
.currentTemperatureC` carries no per-reading timestamp this app captures,
and `HomeKitSensorReading` has no timestamp field at all. A fresh duct
reading compared against a room reading from 15+ minutes earlier is
comparing two different physical moments — potentially one mid-cooling,
one from before the call even started in earnest.

A general per-zone staleness classifier already exists
(`classifyStaleness`), but it isn't applied to the fault check at all, and
it deliberately exempts a zone last classified `satisfied` ("a comfortable
room's reading is unchanging by design"). That exemption is exactly what
let one of the confirmed incidents through: capacity sharing can still
meaningfully move a `satisfied` zone's vent, so its duct reading can still
be "usable" for this check even while the zone reads as comfortable.

**Decision.** Added `roomReadingStale` to `DuctReadingZone`, gating
`usableZones()` alongside `ductReadingStale`. Computed via a new
`isRoomReadingStale` (tick.ts) — deliberately independent of
`classifyStaleness`, with no `satisfied`-classification exemption, since
this check cares only about "is this literally the same cached value as
before," not why. Sourced from the zone's own persisted
`last_reading_changed_at` (already tracked every tick for the general
staleness alert) as of the _previous_ tick — Step 5 runs before this
tick's own Steps 6-7 staleness computation, the same one-tick-behind
timing every other Step 5 signal (vent position, dwell) already accepts.
Computed once per zone and reused for the later per-zone anomaly check,
same reuse pattern as `ventOpenDwellSatisfied`.

This does not, on its own, prove every stale-reading trigger really was a
false positive — a genuinely broken compressor happening to coincide with
a stale reading is not distinguishable from this signal alone. It only
removes a confirmed source of _invalid_ comparisons; several of the 21
triggers showed a demonstrably _fresh_ room reading and still measured a
sub-threshold differential, meaning this fix alone doesn't resolve
everything (see "Consequences" below).

## Trigger dwell raised from 3 to 15 minutes

Even accounting for the three fixes above, the underlying check remains a
derived heuristic, not a real "the compressor is broken" signal — a
genuinely smaller differential caused by distant ductwork, an as-yet
unflagged zone, or a lingering sensor quirk can look identical, in the
data alone, to a real but transient equipment hiccup. Rather than continue
chasing individual causes as they surface, the 21-trigger audit was used
to find the one property that actually separated every confirmed false
positive from what a real, sustained equipment failure would look like:
**duration**. Every single trigger in the 30-day window self-cleared
within 5-13 minutes. A real failure — a tripped breaker, a dead capacitor,
a refrigerant leak — does not self-clear in 13 minutes.

**Decision.** Raised `equipment_fault_trigger_dwell_minutes` from 3 to 15
— comfortably past the entire observed false-positive range, while still
forcing every vent open (and alerting) well within an hour of a real
failure, far faster than a household would otherwise notice. This is a
deliberate acceptance that the differential-based detector will keep
producing occasional bad single-tick readings for reasons not yet
individually diagnosed, in exchange for not needing to diagnose every one
of them before the false-positive rate becomes tolerable. The existing
`equipment_fault_clear_dwell_minutes` (5 min) is unchanged — once genuinely
triggered, clearing quickly again is still correct.

## Consequences

All four changed defaults alter today's behavior but preserve the check's
core purpose — a real, sustained loss of duct differential across every
usable vent still faults, just after more evidence and more time than
before. `bun run tsc`/`test`/`verify` all pass. Every new setting
(`equipment_fault_thermal_load_leniency_c`,
`equipment_fault_vent_open_dwell_minutes`) is wired into the System
Parameters UI (Emergency fail-safe group), and the pre-existing
`equipment_fault_trigger_dwell_minutes` — previously configurable only via
direct DB edit — was added to that same UI now that its value is
central to this whole effort.

This remains an accepted limitation, not a closed question: the
thermal-load-flag fix (`equipment_fault_thermal_load_leniency_c`) is only
as good as which zones are actually flagged, and Den Front/Martin
Bedroom/Luke Bedroom's frequent appearance in the 21-trigger audit is
suggestive but not yet confirmed as a flagging gap versus genuine
transient equipment behavior — revisit once the room-reading-staleness fix
has had time to change the picture, since the two effects were
entangled in the data available at the time of this ADR. The raised
trigger dwell is the primary current safeguard against acting on any
single bad reading regardless of its cause.
