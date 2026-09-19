# Telemetry range limits and touch timeline scrubbing

- [Telemetry range limits and touch timeline scrubbing](#telemetry-range-limits-and-touch-timeline-scrubbing)
  - [Context](#context)
  - [Root cause](#root-cause)
  - [Decision](#decision)
  - [Consequences](#consequences)

## Context

The telemetry range selector offered one hour, six hours, 24 hours, and seven days, but the server applied the same default Loki limit of 500 points to every request. The client did not send a limit override. At the default 60-second control-tick cadence, 500 points covers only about 8.3 hours, so 24-hour and seven-day selections silently returned only the newest part of the requested range.

The existing Loki query already used `direction: "backward"`, which correctly keeps the newest points when a query is capped. That fixed the earlier failure mode where forward pagination returned the oldest part of the window, but it could not make a uniformly undersized limit represent wider ranges.

The HVAC State, spike-event, and override timelines use the shared custom `TimelineLane` rather than Recharts. The lane listened only for mouse movement. Mobile browsers do not provide continuous mouse movement while a finger drags, so the tooltip updated only for discrete taps instead of following a touch drag.

## Root cause

Telemetry history limit selection was independent of the requested time range. The route used `DEFAULT_LIMIT = 500` whenever the client omitted `limit`, and the client always omitted it. This made wider ranges appear incomplete without an error or truncation indicator.

`TimelineLane` computed hover state from `onMouseMove` and cleared it from `onMouseLeave`. It had no pointer or touch event path and no `touch-action` declaration to allow the lane to own the horizontal gesture.

## Decision

Make the omitted telemetry limit proportional to the requested range using the configured default control cadence of one point per 60 seconds. Keep an explicit upper bound of 20,000 points, which covers the full seven-day selector at that cadence while retaining protection against unexpectedly large Loki responses. Explicit `limit` values continue to be validated against the same bound, and Loki's backward query direction remains unchanged.

Change `TimelineLane` to use pointer movement and pointer leave events. Pointer events provide one interaction path for mouse, pen, and touch input. Set `touch-action: none` on the lane so a touch drag is delivered to the lane continuously instead of being claimed by browser scrolling.

## Consequences

The 24-hour and seven-day selectors now request enough history for the normal 60-second tick cadence, rather than silently stopping at approximately 8.3 hours. The seven-day response can contain about 10,080 points, so the client and charts must continue to handle a substantially larger dataset. A deployment running a materially faster control cadence can still reach the safety cap and should revisit the limit strategy if that becomes a real configuration.

Categorical telemetry timelines now scrub continuously on touch devices while preserving the existing desktop hover behavior. Because the lane owns touch gestures, vertical page scrolling that begins directly on a timeline may require starting the gesture outside the lane.
