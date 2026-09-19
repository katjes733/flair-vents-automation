# HomeKit session recovery after network disruption

- [HomeKit session recovery after network disruption](#homekit-session-recovery-after-network-disruption)
  - [Context](#context)
  - [Root cause](#root-cause)
  - [Decision](#decision)
  - [Consequences](#consequences)
  - [Verification](#verification)

## Context

A router reboot caused the HomeKit connection to an Ecobee HAP bridge to remain unavailable after the network came back. The control loop continued running, but HomeKit reads failed and the controller fell back to Flair readings, leaving sensor and HVAC state stale until recovery.

Loki showed 664 `ECONNREFUSED` failures against the same endpoint, `192.168.2.209:45317`, from approximately `2026-09-19T10:03:15Z` through `2026-09-19T15:32:22Z`. There were no discovery recovery events during the refusal streak.

The HomeKit client already had an address and port discovery ladder, backed by the persistent `HapDiscoveryRegistry`. That recovery path only ran while establishing a connection. Once an `HttpClient` had been created, subsequent ticks reused it directly.

## Root cause

The router reboot invalidated the established HAP TCP session. `HapControllerClient` retained the dead `HttpClient`, so every later read reused the same failed transport and the client never reached cached-address lookup or mDNS rediscovery.

The persistent discovery registry could evict stale addresses through `reportStaleEntry()`, but the active-session failure path never reported the session as stale. The result was a durable refusal loop rather than a failed attempt followed by rediscovery.

## Decision

When a HomeKit read fails through an established session, invalidate that session before recovery:

- Clear the cached `HttpClient` and resolved characteristic state.
- Report the accessory's discovery entry as stale so the registry can evict it and apply its normal miss and rebind behavior.
- Retry the read once through the existing connection and discovery ladder.
- Preserve the existing control-loop fallback to Flair if the recovered attempt also fails.

Only reads are retried automatically. HomeKit writes are not blindly replayed after a transport failure because an `ECONNREFUSED` or equivalent error does not prove that the accessory failed to apply the original write. Replaying it could duplicate or reorder a user or controller action. A later control tick may issue a new write from current state, but the failed write operation itself is never transparently replayed.

## Consequences

A router reboot or similar network interruption can now recover without restarting the worker, provided the accessory becomes discoverable again. The first failed read still incurs one recovery attempt, and the control loop continues to use Flair fallback while HomeKit is unavailable.

The retry is intentionally bounded to one attempt per read. If the network, accessory, pairing, or mDNS discovery remains unavailable, the existing error handling and persistent outage alerting still apply. The discovery registry's persistent process and stale-entry handling remain the source of truth for rediscovery; this decision only makes failed active sessions feed that recovery path.

The no-replay write policy favors avoiding duplicate device actions over immediate write recovery. This is acceptable because the normal tick loop reevaluates desired state and can produce a fresh write once a later read and connection succeed.

## Verification

Added a regression test covering the incident sequence: a healthy read, a refused established session, stale-entry reporting, fresh discovery, and a successful read from the newly created client. The focused HomeKit client suite passed 10/10 tests.

Full `bun run verify` passed, including Prettier, ESLint, Stylelint, TypeScript checking, 1,816 tests, coverage thresholds, and the dependency audit with no vulnerabilities.
