# Flair API Schema — Phase 0 Discovery Findings

- [Flair API Schema — Phase 0 Discovery Findings](#flair-api-schema--phase-0-discovery-findings)
  - [How this was gathered](#how-this-was-gathered)
  - [Grant mode](#grant-mode)
  - [Resource model — the critical correction](#resource-model--the-critical-correction)
  - [Confirmed resource shapes](#confirmed-resource-shapes)
    - [`structures`](#structures)
    - [`zones`](#zones)
    - [`structure-states` (structure's `current-state`)](#structure-states-structures-current-state)
    - [`thermostats`](#thermostats)
    - [`thermostat-states` (thermostat's `current-state`)](#thermostat-states-thermostats-current-state)
    - [`rooms`](#rooms)
    - [`vents`](#vents)
    - [`vent-sensor-readings` (vent's `current-reading`)](#vent-sensor-readings-vents-current-reading)
    - [`remote-sensors`](#remote-sensors)
  - [Phase 0 checklist — resolved](#phase-0-checklist--resolved)
  - [Open items — need a decision or further discovery](#open-items--need-a-decision-or-further-discovery)
  - [Not yet tested](#not-yet-tested)

## How this was gathered

Live, read-only discovery via `scripts/flairDiscovery.ts` against the real account (`client_credentials` grant), run twice (once to confirm auth, once expanded after the first pass revealed the `zones` resource). No write/PATCH calls have been made against this account yet — see [Not yet tested](#not-yet-tested).

## Grant mode

**`client_credentials` works for this account.** Token response:
- `expires_in: 864000` (**10 days**, not the ~1 hour this plan defensively assumed) — see the note under [Open items](#open-items--need-a-decision-or-further-discovery); this changes the token-budget risk calculus significantly.
- `refresh_token`: **absent** under this grant (expected — client_credentials doesn't need one; the client just re-requests directly).
- `scope` returned (space-separated): `structures.view structures.edit vents.view vents.edit thermostats.view thermostats.edit sensors.view sensors.edit pucks.view pucks.edit users.view users.edit ir-codes.view offline_access openid email profile` — full read/write access across every resource type this app needs.

## Resource model — the critical correction

**This plan's Data Model currently assumes `air_handlers.flair_structure_id` links one air handler to one Flair *structure*. That's wrong, confirmed by live data**, and needs a data-model correction before any more domain code is built against it:

- This account has exactly **one `structures` resource** (`id: "92514"`, `name: "Home"`) — a structure is the whole house/account, not one per air handler.
- That one structure contains exactly **one `zones` resource today** (`id: "731909"`, `name: "Upstairs"`) — and **`zones` is the actual "one air handler" concept**: a zone has its own `rooms` relationship (5 rooms, matching Upstairs's real room list), its own `thermostat` relationship (exactly one), and zone-level attributes that are unmistakably per-air-handler (`staged-heating-mode`, `staged-heating-set-point-c`, `droop-offset-c`, `cutover-temperature`, `cutback-temperature`, `maximum-static-pressure`).
- A `rooms` resource belongs to exactly one `zones` resource (confirmed: room "Den back"'s `zones` relationship points to the same `731909` as the zone's own `rooms` list).
- A `thermostats` resource belongs to exactly one `zones` resource too (confirmed: the "Upstairs" thermostat's `zone` relationship is also `731909`).

**The correct mapping**: `installations` ↔ Flair `structures` (1:1, the whole house/account); `air_handlers` ↔ Flair `zones` (many per structure). **`air_handlers.flair_structure_id` should be renamed `air_handlers.flair_zone_id`**, and a new `installations.flair_structure_id` (nullable unique) should be added for the structure-level linkage this app didn't previously have anywhere to put (needed for the structure-level `home-away` reading and the structure's own `active-schedule`/`current-state`). This is a schema change, not just a naming nit — raised here for your decision before I touch the migration.

## Confirmed resource shapes

Only the fields relevant to this app are listed; every resource returns substantially more JSON:API boilerplate (relationships to invitations, releases, beacon-sightings, etc.) that's irrelevant here and omitted.

### `structures`

| Field | Value seen | Notes |
|---|---|---|
| `set-point-temperature-c` | `22.23` | Structure-level setpoint. Two decimal places — **not** rounded to 0.5°C increments as this plan assumed; see [Open items](#open-items--need-a-decision-or-further-discovery). |
| `mode` | `"auto"` | Configured heat/cool/auto mode. |
| `structure-heat-cool-mode` | `"cool"` | Resolved mode given `mode: auto`. |
| `time-zone` | `"America/Phoenix"` | **Flair itself stores an IANA time zone at the structure level.** Directly relevant to `home_timezone` — see [Open items](#open-items--need-a-decision-or-further-discovery). |
| `temperature-scale` | `"F"` | Confirms the account's *display* unit is Fahrenheit while every `-c` field is genuinely Celsius — matches this plan's canonical-Celsius-storage design exactly; no correction needed. |
| `home` | `true` | Present but redundant with `structure-states.home-away` below — use the latter. |
| `is-active` | `false` | Unclear meaning yet — doesn't obviously track "is the equipment currently calling." Don't assume; the real call-state signal is `thermostat-states.operating-state` (below). |
| `use-single-set-point` | `true` | Single-setpoint mode, not independent heat/cool setpoints, for this structure today. |

### `zones`

One zone (`731909`, name `"Upstairs"`) confirmed today. Key attributes:

| Field | Value seen | Notes |
|---|---|---|
| `staged-heating-mode` | `"DISABLED"` | **Confirms no staging is configured** — consistent with the bridged-Y1/Y2 fact already in this plan. |
| `staged-heating-set-point-c` / `staged-heating-trigger` | `22.23` / `null` | Present but inert while staging is disabled. |
| `droop-offset-c` | `2.77` | Unconfirmed exact semantics — plausibly a hysteresis/overshoot allowance. Worth a closer look before the Domain Research Directive finalizes topology limits. |
| `cutover-temperature` / `cutback-temperature` | `1.67` / `7.23` | Also unconfirmed exact semantics — staging-related, likely inert while `staged-heating-mode: DISABLED`. |
| `maximum-static-pressure` | `null` | **A pressure-related field exists on zones** — unset for this installation. Worth investigating for the Domain Research Directive (Flair may already track/limit static pressure natively). |
| relationship: `hvac-unit` | `null` | An "hvac-unit" resource type exists in principle; not linked for this zone. Possibly where genuine equipment fault/diagnostic data would live if ever populated — see [Open items](#open-items--need-a-decision-or-further-discovery). |

### `structure-states` (structure's `current-state`)

| Field | Value seen | Notes |
|---|---|---|
| `home-away` | `"Home"` | **Confirms Ecobee/Flair-sourced Home/Away is exposed.** Structure-scoped in the data seen so far — see the per-zone-vs-structure-wide open question below. |
| `home-away-manual` | `false` | Suggests this specific value came from an automatic source (geofencing/Ecobee), not a manual override — consistent with what this plan needs. |
| `heat-cool-mode` | `"COOL"` | Structure-level resolved mode, redundant with the structure's own `structure-heat-cool-mode`. |
| `set-point-mode` | `"Home Evenness For Active Rooms Flair Setpoint"` | Flair's own native balancing mode label — confirms this account is still under Flair's native control (expected; Manual System Mode hasn't been set yet, matching this plan's pre-cutover prerequisite). |

### `thermostats`

| Field | Value seen | Notes |
|---|---|---|
| `make` | `"ecobee"` | Confirmed. |
| `operating-state` | `"cool"` | See `thermostat-states` below — same field, more useful there since it's timestamped. |
| `mode` | `"COOL"` | Configured mode. |
| `last-non-idle-mode` | `"COOL"` | Implies `operating-state` can be `"idle"` — i.e., **idle is a distinct value from a call state**, exactly what a real call-state signal needs. |
| `is-offline` | `false` | Connectivity, not equipment-fault — see [Open items](#open-items--need-a-decision-or-further-discovery). |
| `is-out-of-sync` | `false` | Sync-health, same caveat. |
| `current-set-point` | `21.77787777777778` | High-precision float — confirms no rounding happens on the read side either. |
| relationship: `zone` | `731909` | Confirms the zone↔thermostat 1:1 link above. |
| relationship: `remote-sensor` (singular) | one `remote-sensors` resource | See below — this is the mechanism, not a "sensor group" list. |

### `thermostat-states` (thermostat's `current-state`)

**This is the single most valuable resource found — it's exactly the `thermostatReading` input this plan's Ecobee/Bosch mechanism needs, already resolved by Flair.**

| Field | Value seen | Notes |
|---|---|---|
| `ambient-temperature-c` | `23.11121111111111` | **This is `thermostatReading`.** Whatever sensor(s) Ecobee is actually comparing against, already resolved into one number — no need to separately track "which sensor is in the comfort-setting group" to get this value. Confirms Piece 1 (offset correction) needs nothing beyond this one field, fetched fresh every tick. |
| `operating-state` | `"cool"` | **The real-time equipment call state.** Distinct from `mode` (configured). This is the field `deriveHvacState()` should read. |
| `upper-setpoint-c` / `lower-setpoint-c` / `target-temperature-c` | all `21.77787777777778` today | Equal because this account uses a single setpoint, not independent heat/cool setpoints; the three-field shape suggests dual-setpoint accounts would have them differ. |
| `fan-state` | `"auto"` | Fan mode, confirmed exposed. |
| `home-away` | `"Home"` | Mirrors the structure-level value — see the per-zone-vs-structure-wide open question. |
| `online` | `true` | Thermostat connectivity — same caveat as `is-offline`/`is-out-of-sync`. |
| `written` / `written-confirmed` / `written-failures` / `written-at` | `false` / `false` / `null` / `null` | **Not anticipated by this plan at all, and potentially very useful**: looks like write-acknowledgment tracking for whatever setpoint Flair has pushed to the physical Ecobee. If confirmed, this could directly answer "did our setpoint push actually land" — worth a follow-up discovery pass once a real write test happens. |
| `humidity` | `61` | Present, not currently used by this plan. |

### `rooms`

| Field | Value seen | Notes |
|---|---|---|
| `current-temperature-c` | `23.61121111111111` | High precision, unrounded — matches `thermostat-states.ambient-temperature-c`'s precision. |
| `set-point-c` | `22.23` | Per-room resolved setpoint. |
| `room-conclusion-mode` | `"COOL"` | Room-level resolved mode — plausibly Flair's own per-room satisfied/demanding-equivalent classification. Worth comparing against this plan's own `classifyZone()` output once live, as a sanity cross-check, not a replacement. |
| `heat-cool-mode` | `"FLOAT"` | Per-room mode setting — `FLOAT` here specifically for a room with `hold-reason: "Schedule Event"`. |
| `active` | `true` | Corresponds to this plan's zone `active`/inactive-schedule-event concept — not yet mapped precisely. |
| relationship: `vents` | `[]` for "Den back" | **Confirms**: empty `vents` array = no smart vent (this plan's `no_vent`/sensor-only case). |
| relationship: `pucks` | `[]` for "Den back" | Empty = no Flair-branded puck. |
| relationship: `remote-sensors` | one entry for "Den back" | Non-empty = has an Ecobee-side sensor. This triple (`vents`/`pucks`/`remote-sensors` array lengths) is exactly how to derive `has_temperature_sensor`/`has_occupancy_sensor`/`vent_hardware_type` at sync time — answers the "how rooms distinguishes vent vs. puck-only vs. neither" checklist item cleanly. |
| relationship: `thermostat` | `{type: "thermostats", id: null}` | Present but null for a non-thermostat room — the room actually hosting the physical thermostat presumably has a real id here (not yet confirmed which room that is). |

### `vents`

| Field | Value seen | Notes |
|---|---|---|
| `percent-open` | `100` | Confirmed field name — matches this plan's placeholder exactly. |
| `percent-open-reason` | `"Vent will close when the room is below 71.0F."` | **Not anticipated** — a human-readable explanation Flair itself generates. High-value for logging/diagnostics with zero extra computation; worth surfacing directly in the UI/log narrative. |
| `voltage` | `3.18` | Battery-adjacent (voltage, not a percentage) — confirms Phase 3 `HardwareDiagnostics`' battery field exists, just under a different name/unit than assumed. |
| `current-rssi` | `-69` | Confirmed, matches this plan's assumption. |
| `motor-duty-cycle-percent` / `motor-overdrive-ms` / `setup-lightstrip` / `has-buzzed` | present | Additional low-level hardware fields, all Phase-3-relevant, none currently used by this plan's design. |
| `inactive` | `false` | Plausibly the "vent removed/disabled" signal this plan's degraded-vent handling could check — not yet confirmed how this differs from a vent that's simply unreachable. |
| relationship: `room` | one room | Confirmed 1:1 vent→room. |
| relationship: `current-reading` | `vent-sensor-readings` | See below — the reading is a separate, timestamped sub-resource, not embedded in the vent's own attributes. |

### `vent-sensor-readings` (vent's `current-reading`)

| Field | Value seen | Notes |
|---|---|---|
| `created-at` | `2026-08-28T00:03:02.387552+00:00` | **This is the per-reading timestamp** this plan's staleness/spike-detection design needs — distinct from the vent's own `updated-at`. Answers "genuinely fresh vs. cached" and "per-reading last-updated timestamp" together: fetch this sub-resource, compare its `created-at` tick over tick. |
| `duct-temperature-c` | `16.75` | **Not anticipated** — a duct-side temperature reading. Plausibly useful as an independent "is air actually flowing" signal (a cold duct temp during a cooling call implies real airflow) — flagged as a possible future diagnostic, not adopted into the current design without more investigation. |
| `motor-current` / `motor-run-time` / `system-voltage` / `firmware-version-s` / `lights` | present | More Phase-3 hardware fields. |

Note: `GET /api/vents/{id}/current-state` returned a 404 — vents don't have their own `current-state` the way structures/zones/thermostats do; `current-reading` is the equivalent for this resource type.

### `vent-states` (a vent's own state-change history)

Investigated specifically to answer: *is "the vents opened themselves" something Flair's cloud logic does deliberately (and visibly), or an opaque hardware behavior?* **Answer: deliberate, and fully visible.** Every vent-position change is a `vent-states` record with:

| Field | Value seen | Notes |
|---|---|---|
| `set-by` | `"System"` | **Confirms these changes come from Flair's own cloud logic, attributed as such** — not an opaque firmware default, and not (yet) this app, which doesn't write anything today. |
| `percent-open-reason` | e.g. `"Vent will close when the room is below 71.0F."`, `"Vent will open when the room is above 73.0F."`, `"Enhanced circulation is enabled: Vent open for airflow."` | **Flair generates a human-readable reason for every position change it makes.** The temperature-threshold reasons show simple per-room bang-bang control (roughly a 2°F open/close hysteresis band per room) — not an obviously backpressure-aware algorithm, at least not one that says so in the reason text. The "Enhanced circulation" reason directly corresponds to `thermostats.enhanced-circulation-mode: "ALL VENTS"`. |
| `changeset` | e.g. `["percent_open", "percent_open_reason"]` | Which fields this particular record actually changed. |
| `created-at` | timestamped | Same per-record timestamp pattern as `vent-sensor-readings`. |

**Worth flagging as a possible future enhancement, not adopted now**: if the vents PATCH endpoint accepts writing `percent-open-reason` (untested), this app could push its own human-readable reason alongside a position change — meaning your own decisions ("closed — satisfied and unoccupied during an active call") would show up directly in the Flair mobile app, not just in this app's own logs/UI.

### `zone-auto-conclusions` (a zone's own decision history)

Another real-time call-state signal, redundant with `thermostat-states.operating-state` but independently confirming it: `state: "ON"`/`"OFF"` per historical tick, with `mode`, `delta` (the temperature delta driving the decision), and `state-reason`. `set-by-reason: "Create-ThermostatStates"` ties each conclusion back to a specific thermostat-state change. No backpressure-specific reason appears here either — `state-reason: "ACTIVE"` reflects overall zone activity, not a specific backpressure-relief action.

**On the structure's own `backpressure-priority: "Prioritize Inactive Rooms"` setting** (seen in the raw `structures` dump): this is a real, configured native policy, but nothing in the vent- or zone-level history checked so far shows it firing as an explicit, attributable reason. The direct evidence collected here shows simple per-room temperature-threshold bang-bang control as the mechanism actually visible in the audit trail — the backpressure setting may bias how those per-room thresholds get computed under the hood, but that's inference, not confirmed by a reason string the way the temperature-threshold behavior is.

### `remote-sensors`

Two kinds observed via the same resource type, distinguished by `is-tstat`:
- `is-tstat: true`, `sensor-type: "ecobee_thermostat"` — the thermostat's own onboard sensor, itself modeled as a `remote-sensors` entry.
- `is-tstat: false`, `sensor-type: "ecobee_ecobee3_remote_sensor"` — a genuine Ecobee SmartSensor, linked to a specific `room`.

`GET /api/thermostats/{id}/remote-sensor` (**singular**) returns exactly one currently-active sensor — for this account, right now, that's the thermostat's own onboard sensor (`is-tstat: true`), not any room's remote SmartSensor. This is a live, real finding, not a hypothetical: **it means `ambient-temperature-c` right now reflects only the thermostat's own physical location, not an averaged comfort-setting group** — which is exactly the scenario this plan's offset-correction mechanism (Piece 1) is designed to handle without needing to know or change which sensor is active.

## Phase 0 checklist — resolved

| Item | Status |
|---|---|
| Real-time equipment call state vs. configured mode | **Resolved** — `thermostat-states.operating-state` (live) vs. `thermostats.mode` (configured); `"idle"` is a distinct value (implied by `last-non-idle-mode`). |
| Stage/modulation data | **Resolved** — `zones.staged-heating-mode` etc.; confirms no staging active, consistent with the bridged-Y1/Y2 fact already in this plan. |
| `set-point-temperature-c` write behavior / rounding | **Partially resolved** — field confirmed on `structures`; the actual *write* granularity is untested (no PATCH attempted yet). Read-side values carry full float precision, not rounded. |
| Per-room setpoint/hold, distinct from structure-level | **Resolved** — `rooms.set-point-c` + `rooms.hold-reason`/`hold-until` exist independently of the structure-level setpoint. |
| Ecobee-sourced Home/Away visibility | **Resolved** — `structure-states.home-away` / `thermostat-states.home-away`, both currently `"Home"`. |
| Active comfort-setting sensor group — present? | **Resolved (differently than assumed)** — there's no separate "sensor group" list to read or write; `thermostats.remote-sensor` (singular) tells you which one sensor is currently active, and `thermostat-states.ambient-temperature-c` already gives you the resolved comparison value directly. Writability untested (not needed for this plan's design either way). |
| Per-room sensor identity/source | **Resolved** — `rooms.remote-sensors` relationship; `remote-sensors.sensor-type` distinguishes the thermostat's own sensor from a genuine SmartSensor. |
| Per-reading "last updated" timestamp | **Resolved** — `vent-sensor-readings.created-at` (and presumably `thermostat-states.created-at`, `remote-sensors`' own current-reading likewise), distinct from the parent resource's `updated-at`. |
| Genuinely fresh vs. cached value | **Resolved** — same mechanism as above. |
| Single vs. per-handler `structures` modeling | **Resolved — and it's a correction, not a confirmation.** See [Resource model — the critical correction](#resource-model--the-critical-correction). |
| How `rooms` distinguishes vent vs. puck-only vs. neither | **Resolved** — derive from whether `vents`/`pucks`/`remote-sensors` relationship arrays are empty or not. |
| Battery/RSSI fields on vents | **Resolved** — present (`voltage`, `current-rssi`), confirming Phase 3's `HardwareDiagnostics` has real fields to show. |

## Open items — need a decision or further discovery

1. **The zones-vs-structures data-model correction** (see above) needs your go-ahead before I touch the schema/`FlairClient` resource methods.
2. **No genuine equipment-fault field found** in any resource's *current* attributes (`is-offline`, `is-out-of-sync`, `online` are connectivity/sync-health, not an HVAC-equipment fault like a tripped safety switch or refrigerant issue). Investigated further, specifically: whether "the vents opened themselves automatically" (the real, observed incident motivating this plan) is a hardware behavior or Flair's own cloud logic — confirmed the latter, and confirmed it's fully attributable: every vent-position change is a `vent-states` record with `set-by: "System"` and a generated `percent-open-reason` explaining why (see [`vent-states`](#vent-states-a-vents-own-state-change-history) above). **This resolves the "is it invisible to the API" half of the question — it's not; every automatic action Flair takes is visible with a stated reason** — but it does **not** surface a distinct "equipment fault" concept; the reasons observed are ordinary per-room temperature-threshold and circulation logic, not fault handling. **This still needs a joint decision**: treat `online`/`is-offline` as the (weaker, differently-scoped) fail-safe trigger anyway, or design the Emergency Fail-Safe to have no automatic trigger at all for now (manual disarm remains the safety net), or keep looking (the null `hvac-unit` relationship on `zones` might lead somewhere if it's ever populated — untested, since this account doesn't have one linked).
3. **`home_timezone` — Flair already has one (`structures.time-zone: "America/Phoenix"`, which happens to already match this plan's own placeholder default).** Worth deciding whether `system_settings.config.home_timezone` should be seeded from this (once the structure link exists) rather than left as a pure local default — a much better source than either the removed env var or a hardcoded guess, since it's the value you already configured in the real Flair app.
4. **Home/Away scope (per-zone vs. structure-wide) is genuinely unconfirmed** — both `structure-states.home-away` and `thermostat-states.home-away` show the same value today, but with only one zone/thermostat active, there's no way to tell whether a second zone could independently report a different Home/Away state, or whether it's truly one global value mirrored everywhere. Revisit once/if a second air handler is activated.
5. **`written`/`written-confirmed`/`written-failures` on `thermostat-states`** could be exactly the write-acknowledgment signal this plan doesn't currently have any equivalent for — worth confirming behavior once a real setpoint-push write test happens.
6. **`droop-offset-c`, `cutover-temperature`, `cutback-temperature`, `zones.maximum-static-pressure`** — plausibly relevant to the Domain Research Directive's pressure-safeguard work, exact semantics unconfirmed.

## Not yet tested

- Any write/PATCH call (vent position, structure/zone setpoint) — deliberately deferred as a separate, explicitly-authorized step given the real physical consequences of actuating this account's real hardware.
- `authorization_code` and `refresh_token` grant modes (client_credentials already confirmed sufficient).
- A force-fresh-read parameter/endpoint (no evidence found in the resources fetched so far, not specifically searched for).
- Refresh-token expiry / whether refreshes count against the ~50/day creation budget / per-account-vs-per-client-app scoping — these need Flair's own developer/account documentation, not a live API call; not yet researched.
