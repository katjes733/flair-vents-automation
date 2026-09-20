# App-owned fan runtime scheduling

- [App-owned fan runtime scheduling](#app-owned-fan-runtime-scheduling)
  - [Context](#context)
  - [Decision](#decision)
  - [Scheduling policy](#scheduling-policy)
  - [Control boundaries](#control-boundaries)
  - [Consequences](#consequences)

## Context

The application already owns heat and cooling decisions by writing the corresponding Ecobee temperature holds and already reads the thermostat's actual fan state through HomeKit. Ecobee also has an independent fan-runtime-per-hour schedule, currently configured for 20 minutes per hour. That independent scheduler can start the blower without giving the application a reliable opportunity to prepare vents first.

A live HomeKit experiment confirmed that writing the thermostat's writable `TargetFanState` characteristic to `Manual` starts the blower, while restoring it to `Auto` returns control to Ecobee. The application must therefore own fan-only circulation if it is to coordinate fan operation with vent positions. `CurrentFanState=Blowing Air` remains the source of truth for measured blower runtime.

## Decision

The application becomes the sole owner of fan-only circulation for each enabled air handler. Ecobee's fan-runtime-per-hour schedule must be disabled manually before enabling the feature. A one-time per-air-handler acknowledgement records that the user completed this migration; HomeKit cannot inspect or disable Ecobee's cloud-side fan-runtime setting.

The application continues to own heat/cooling decisions through the existing temperature-hold controller. Fan-only scheduling never writes `TargetHeatingCoolingState`, never cancels or rewrites an active temperature hold, and yields immediately to an active heat/cool call.

Fan scheduling is configured per air handler with a wall-clock hourly target. The target is selected in five-minute increments from the feasible range. A separate enablement switch controls whether the scheduler is active. System-wide mechanical scheduling policy provides the defaults and bounds; an air handler may opt into a higher minimum fan-only block in its advanced settings.

## Scheduling policy

- Runtime is credited from observed `CurrentFanState=Blowing Air`, not from commands issued.
- Confirmed heat/cool blower runtime receives one-for-one credit toward the same hourly target. Overlapping runtime is counted once.
- Runtime intervals are split at wall-clock hour boundaries.
- The effective minimum fan-only block is at least 5 minutes. A small remaining deficit still runs the full minimum and may overshoot; overshoot is recorded and not carried as negative credit.
- A fan-only block is at most 15 minutes by default.
- At most three application-created fan-only blocks may start in one wall-clock hour.
- A hard 15-minute gap separates fan-only blocks. The scheduler never compresses this gap to chase an impossible target.
- The scheduler uses adaptive blocks, preferring fewer meaningful runs while spreading circulation through the hour. It does not intentionally cross an hour boundary.
- If the configured target cannot fit within the current policy envelope, the configuration is rejected or the hour records a shortfall; safety and anti-short-cycling limits are never violated.

The normal target selector therefore exposes only feasible five-minute values. With the default policy, the available values are Disabled, 5, 10, 15, 20, 25, and 30 minutes per hour. Feasibility is calculated from the current system parameters and the air handler's effective minimum rather than hardcoded permanently.

## Control boundaries

Heat/cool has priority over fan-only circulation. If a heat/cool call appears during an application fan-only block, the application restores `TargetFanState=Auto` in the same logical tick, leaves the existing temperature hold intact, and continues through the existing vent pre-opening and call-control path. Physical fan and vent confirmation remains asynchronous and is verified on the next tick.

The scheduler prepares vents toward their fan-only baselines before requesting `Manual`. It does not start fan-only operation when HomeKit is unavailable, vents cannot be prepared, or a start confirmation does not arrive before the configured timeout. A pre-existing `Manual` fan target is treated as an external override and surfaced as an alert rather than silently claimed by the application.

A global kill switch remains authoritative. On restart, the application reconciles actual HomeKit state before creating a new block and does not assume that a stale `Manual` target belongs to the application.

## Consequences

The application gains deterministic coordination between fan operation, vent preparation, heat/cool calls, and hourly runtime accounting. Ecobee remains responsible for equipment behavior and heat/cool execution, but no longer independently schedules fan-only circulation.

The application must persist hourly runtime accounting durably and maintain active fan-block state across ticks and worker restarts. System-parameter changes must validate every enabled air handler in memory before persistence; an update that would make any configured target infeasible is rejected with the impacted air handlers listed.

Fan scheduling can intentionally overshoot a small deficit and can report shortfall when the target cannot fit. This is preferable to short cycling, violating the hard gap, running beyond the hour boundary, or silently changing user configuration.
