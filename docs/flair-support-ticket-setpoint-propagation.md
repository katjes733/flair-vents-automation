# Flair support ticket — setpoint propagation to Ecobee requires System Mode "auto," which breaks third-party vent control

- [Flair support ticket — setpoint propagation to Ecobee requires System Mode "auto," which breaks third-party vent control](#flair-support-ticket--setpoint-propagation-to-ecobee-requires-system-mode-auto-which-breaks-third-party-vent-control)
  - [Summary](#summary)
  - [Account / device details](#account--device-details)
  - [Test 1 — structure-level write, System Mode "manual"](#test-1--structure-level-write-system-mode-manual)
  - [Test 2 — room-level write, System Mode "manual"](#test-2--room-level-write-system-mode-manual)
  - [Test 3 — the same room-level write, after switching System Mode to "auto"](#test-3--the-same-room-level-write-after-switching-system-mode-to-auto)
  - [Test 4 — marking a room "Inactive" as a possible workaround](#test-4--marking-a-room-inactive-as-a-possible-workaround)
  - [Contrast: the Flair app itself works instantly](#contrast-the-flair-app-itself-works-instantly)
  - [What this means for our integration](#what-this-means-for-our-integration)
  - [Questions for Flair](#questions-for-flair)

## Summary

We've isolated a real conflict in the documented REST API, not a single bug: **setpoint writes only propagate to a connected Ecobee thermostat while the structure's System Mode is `"auto"` — but `"auto"` is also the mode under which Flair's own native vent-balancing actively fights any third-party vent-position command**, which is exactly why System Mode `"manual"` exists and is the documented prerequisite for third-party vent control. Under `"manual"`, our setpoint writes are accepted and persisted but never reach the physical thermostat, across two different write paths and two independent test windows. Under `"auto"`, the same kind of write does propagate — confirmed over a longer window with real, gradual convergence — but only because Flair's own control is active, which then overrides any vent position we try to set. We could not find any middle ground: marking a room "Inactive" does not exempt it from Flair's control, it makes Flair actively force that room's vent closed instead.

We need to understand whether this is expected, by-design platform behavior, and whether there's any other setting or mechanism that lets a third-party integration drive both the thermostat setpoint and individual vent positions at the same time.

## Account / device details

- Structure ID: `92514`
- Thermostat ID: `bfc1e31b-d9ba-46ca-a400-95d22e638b7b`
- Set Point Controller: "Flair App" (`structures.set-point-mode: "Home Evenness For Active Rooms Flair Setpoint"`)
- Test room: "Den Front" (room ID `222951`, the room containing the bridged thermostat)
- A second room, "Luke Bedroom" (room ID `222954`), was used for the Inactive-room test in Test 4, to avoid disturbing the in-progress setpoint test on Den Front

## Test 1 — structure-level write, System Mode "manual"

To rule out any interference from our own integration, we temporarily disabled our own app's control loop entirely (confirmed zero writes from our side for the full test window), with the structure's System Mode set to `"manual"`, then made a single, isolated write directly against the documented REST API:

```
PATCH /api/structures/92514
{
  "data": {
    "type": "structures",
    "id": "92514",
    "attributes": { "set-point-temperature-c": 20.0 }
  }
}
```

This is the same payload shape used by other working third-party integrations against this same endpoint (e.g. the `set_attributes` method in the `home-assistant-flair` community integration).

Polled `GET /api/thermostats/bfc1e31b-d9ba-46ca-a400-95d22e638b7b/current-state` once a minute for 10 minutes afterward:

- The structure's own `set-point-temperature-c` correctly held `20` for the full 10 minutes — confirming the write was accepted and persisted.
- The thermostat's `current-state` resource did refresh once during the window (`created-at` advanced from `18:29:41` to `18:36:08`) — confirming a real Flair↔Ecobee sync cycle ran.
- Despite that real sync cycle, `target-temperature-c` on the thermostat never changed from its pre-test value.
- `written` / `written-confirmed` / `written-failures` stayed `false` / `false` / `null` throughout — no write ever appears to have been attempted toward the thermostat.

## Test 2 — room-level write, System Mode "manual"

We found that other real third-party clients (`RobertD502/home-assistant-flair`'s current implementation, and its precursor `hass-flair-helper`) write the setpoint per-room rather than at the structure level, so we tested that separate path directly, again with System Mode still `"manual"` and our own app's control loop disabled:

```
PATCH /api/rooms/222951
{
  "data": {
    "type": "rooms",
    "id": "222951",
    "attributes": { "set-point-c": 20.0, "active": true }
  }
}
```

The write was accepted (`200`) and — notably, unlike the structure-level write — came back with real attribution: `"hold-reason": "Set by Martin"`, `"set-point-manual": true`. We polled for 10 more minutes:

- The room's `set-point-c` held at `20` the entire time, with the same "Set by Martin" attribution.
- Two independent real sync cycles ran during the window (`created-at` advanced twice: `19:23:33` → `19:33:40` → `19:41:07`).
- `target-temperature-c` on the thermostat never moved, and `written`/`written-confirmed` stayed `false`/`false` throughout both cycles.

So the room-level write is treated as a more clearly "real" user action than the structure-level one (it gets attributed, and marks `set-point-manual: true`), but it fails to propagate in exactly the same way.

## Test 3 — the same room-level write, after switching System Mode to "auto"

With the `20.0` room-level write from Test 2 still in place, we switched the structure's System Mode from `"manual"` to `"auto"` (letting Flair's own native control resume) and kept polling, with our own app still fully disabled:

- Within about 2 minutes of the mode switch, `written` flipped to `true` for the first time in any of our tests, and `target-temperature-c` moved from its prior value toward our written `20°C`, in one real step.
- Over the next ~40 minutes, the value continued moving in the correct direction — both the computed target and the thermostat's own ambient reading dropped further, at a physically plausible pace for a real cooling cycle, alongside further real sync cycles.
- `written-confirmed` never flipped to `true` during our observation window, and the value did not fully reach `20°C` in that time, but the sustained, multi-cycle directional movement is a clear, different outcome from Tests 1 and 2, where nothing moved at all across multiple real sync cycles.

This isolates System Mode as the deciding factor: identical write, identical room, identical account — the only variable that changed between "never propagates" and "propagates and converges" was `manual` vs. `auto`.

## Test 4 — marking a room "Inactive" as a possible workaround

Since System Mode `"auto"` is also the mode under which Flair's own native vent-balancing is documented to fight third-party vent-position writes, we tested whether marking an individual room `"active": false` would exempt just that room from Flair's control while leaving the rest of the structure (and setpoint propagation) in `"auto"`.

Using a different room ("Luke Bedroom," to avoid disturbing the in-progress Den Front test), with its vent starting at `0%` (closed, room already satisfied):

1. `PATCH /api/rooms/222954 { "active": false }` — accepted.
2. `PATCH /api/vents/{ventId} { "percent-open": 100 }` — accepted, with `"percent-open-reason": "Manual by User"`.
3. Polled every minute for 9 minutes: the vent held at `100%` for about 5 minutes, then Flair itself forced it back to `0%`, with its own reported reason: **`"percent-open-reason": "This room is inactive."`** — and it stayed forced closed for the remainder of the window.

So marking a room "Inactive" does not exempt it from Flair's control — it does the opposite: Flair actively closes and holds that room's vent shut because it's inactive, overriding our explicit write. This isn't a usable workaround.

## Contrast: the Flair app itself works instantly

Separately from all four tests above, we also observed: changing the home setpoint through the Flair app's own UI (same account, same thermostat, same "Flair App" Set Point Controller mode, System Mode "auto" at the time) updated the real thermostat in well under 5 minutes — effectively immediately, and far faster and more reliably than anything we could reproduce via the documented REST API even under the conditions in Test 3.

## What this means for our integration

We build a home HVAC automation integration that needs to do two things at once: command individual vent positions per room, and push a computed setpoint that reliably reaches the connected thermostat. Based on the four tests above, the documented REST API does not appear to offer a way to do both simultaneously:

- System Mode `"manual"` — vent-position writes work as documented and are not fought by Flair. Setpoint writes (at either the structure or room level) are accepted and persisted but never reach the thermostat, confirmed across two write paths and 20+ minutes of polling with multiple real sync cycles in between.
- System Mode `"auto"` — setpoint writes do propagate, with real, gradual convergence toward the written value. But Flair's own native vent-balancing is then active and overrides third-party vent-position commands, and marking a room "Inactive" does not provide an escape hatch — it makes Flair force that room's vent shut instead.

## Questions for Flair

1. Is this conflict — setpoint propagation requiring System Mode `"auto"`, which is incompatible with reliable third-party vent-position control — expected, by-design behavior? Or should a `"manual"`-mode setpoint write be propagating to the thermostat, and if so, what are we missing?
2. Is there any other setting, mode, or mechanism (beyond System Mode and the room-level `"active"` flag, both of which we've tested) that would let a third-party integration control individual vent positions while still getting reliable setpoint propagation to the connected thermostat?
3. Does the Flair mobile app make a distinct, internal API call when a user changes the setpoint — one with no public equivalent in the documented REST API — or does it simply rely on System Mode being `"auto"` the same way our Test 3 did?
