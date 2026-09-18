# Flair Vents Automation

A home HVAC control system that sits between the thermostat/HVAC equipment and individual room vents, commanding each zone's Flair smart vent independently to balance comfort, airflow, and equipment safety.

## Language

### Call State & Classification

**Zone**:
A room or area controlled independently, with its own vent(s), optional temperature sensor, and comfort target.

**Call** (or **Active Call**):
The HVAC equipment actively conditioning air — `COOLING_CALL` or `HEATING_CALL`. `callActive` is true only in these two states.
_Avoid_: "running", "on"

**IDLE**:
The HVAC state where no call is active and the blower isn't running either.

**FAN_ONLY**:
The HVAC state where the blower circulates air without any active heating or cooling.

**Genuine idle** (or **no call active anywhere**):
The combined condition of IDLE or FAN_ONLY — nothing is being conditioned, regardless of blower activity. Distinct from a zone merely being "satisfied" while a sibling zone is still under an active call.

**Classification**:
A zone's per-tick determination of its relationship to its comfort target: Demanding, Satisfied, Inactive, or Unclassified — No Sensor.

**Demanding**:
A classification meaning a zone's deviation from its target has crossed past its comfort tolerance, in the direction that still needs conditioning.

**Satisfied**:
A classification meaning a zone is not demanding — its temperature sits within, or past the comfortable side of, its comfort tolerance.
_Avoid_: "comfortable" as the classification name — "satisfied" is the actual value.

**Inactive**:
A classification meaning no setpoint was resolved for a zone this tick (e.g. an inactive schedule) — the zone rests at its baseline but still counts toward pressure accounting.

**Unclassified — No Sensor**:
A classification for a zone with no temperature sensor, or a stale reading — no reliable deviation to classify by, so it rests at its (occupancy-scaled) baseline instead of running the proportional curve.

### Position Baselines

**Satisfied baseline** (`satisfied_baseline_position`):
The resting position anchor for a zone that is satisfied _while a sibling zone is still under an active call_. Kept low by default — every percent open here is real conditioned air diverted from a zone that needs it right now.
_Avoid_: "idle baseline", "comfort baseline" — this setting's actual name before it was renamed for being actively misleading (it never applies during idle).

**No-call baseline** (`no_call_active_baseline_position`):
The resting position anchor for any non-demanding zone whenever no call is active anywhere (genuine idle). Safe to set higher than the satisfied baseline, since nothing is being conditioned to divert — resting more open here gives standing pressure headroom for whenever the next call starts.
_Avoid_: "fan-only baseline" — this setting's name before its scope widened to also cover genuine IDLE, not just FAN_ONLY.

**Demand tolerance** / **Overshoot tolerance**:
The asymmetric edges of a zone's comfort deadband. Demand tolerance governs how far past target a satisfied zone must drift before it demands again; overshoot tolerance governs the opposite edge, once already demanding.

### Movement

**Ramp** (Step 2):
The rate-limited, per-tick movement of a vent's commanded position toward its desired target — bounded to a configured maximum step per tick, never an instant jump except where explicitly noted below.

**Fast transition**:
A one-tick exception to the ordinary ramp limit, applied only on the tick a zone's call state actually flips (a call starting or ending) — lets a zone reach its new resting position quickly instead of creeping toward it step by step.

**Dead-zone recovery**:
A jump straight to a configured percentage, bypassing the ordinary ramp limit, for a vent leaving a hard physical extreme (0% or 100%) — Flair vent motors can sit unresponsive to an ordinary-sized step for an unpredictable stretch right off either extreme.

**Sleep-mode quiet anchor**:
A mechanism that freezes a satisfied Sleep-Mode zone's position at a previously-computed target instead of recomputing it every tick, refreshed only after a configured interval or a genuine mode change — minimizes nighttime vent-motor noise.

### Capacity & Priority

**Capacity sharing**:
A comfortable, non-exempt zone giving up its own unclaimed airflow headroom (down to its own floor) to help a struggling sibling zone that's been commanded near its ceiling with no measurable improvement.

**Pressure floor** (or **floor clamp**):
The safeguard that reopens zones, highest-priority first, when the aggregate open airflow would otherwise drop below the HVAC equipment's minimum safe threshold.
