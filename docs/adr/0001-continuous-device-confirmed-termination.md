# Continuous, device-confirmed setpoint termination while idle

`computeSetpointPush`'s termination override — the mechanism that eases the
thermostat's setpoint off once every zone on an air handler is satisfied,
so the real HVAC equipment actually stops calling — used to fire exactly
once, on the single tick the last demanding zone became satisfied. It was
gated on `trackedDrivingZoneId`, which collapses to `null` the instant that
one corrective write succeeds, so nothing ever ran the computation again
afterward. Confirmed live: a cooling threshold sat ~2°F below its real
schedule for 3.5+ hours with zero recovery, because the system stayed
satisfied far longer than one tick and nothing was watching.

We now keep recomputing the termination push every idle tick — not just
the transition tick — using a separate `terminationAnchorZoneId`
(`AirHandlerRuntimeState`) that survives across every idle tick, unlike
`trackedDrivingZoneId`, which exists for the unrelated driving-zone
switch-hysteresis and is deliberately `null` whenever no zone is demanding.
Each tick redispatches only when the freshly computed value doesn't match
what the thermostat is *actually reporting back*
(`resolveReportedThermostatSetpoint` — a real HomeKit characteristic read
where paired, else Flair's relayed value) — not merely "the last write call
didn't throw."

## Considered Options

An earlier version of this fix persisted a boolean "did the last write
succeed" flag and retried only on a thrown error (mirroring the
`pendingTerminationRetryZoneId` field this replaces). Rejected: a local
success flag can't distinguish a genuinely stuck device from one that has
already caught up — Flair's relayed value can lag a real change, and a
schedule change or manual override made directly on the thermostat can
silently undo a write this app still believes "succeeded." Comparing
against the device's own reported value instead makes the loop
self-healing with no extra persisted retry state.

## Consequences

On the Flair delivery path, "confirmed" depends on Flair's own cloud relay
updating `targetTemperatureC`, which can lag a real change by a sync cycle
— so a redo may fire a tick or two longer than strictly necessary after a
write has actually landed. Accepted: a redundant PATCH is harmless, and the
alternative (trusting a local success flag) is what caused the original
bug.
