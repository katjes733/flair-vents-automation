# Grafana Dashboard — Flair Vents Automation

- [Grafana Dashboard — Flair Vents Automation](#grafana-dashboard--flair-vents-automation)
  - [Prerequisites](#prerequisites)
  - [Import](#import)
  - [Panel-to-field mapping](#panel-to-field-mapping)
  - [Panel overview](#panel-overview)
  - [Notes](#notes)

---

## Prerequisites

Before importing, the app must already be deployed with structured JSON (Pino) logging and the Loki Docker logging driver configured. `.github/workflows/deploy.yml` runs the container with `--name flair-vents-automation` and a `LOKI_PIPELINE` that extracts `service` and `air_handler_id` as native Loki stream labels:

```yaml
LOKI_PIPELINE='- json:
    expressions:
      service: service
      air_handler_id: air_handler_id
- labels:
    service:
    air_handler_id:'
```

This app has no multi-tenant/per-site concept at the dashboard level (see "Multi-tenancy" in the implementation plan — today there's exactly one installation), so there's no `$site`-equivalent variable to add after import.

**Every panel here uses one stream selector**: `{container_name="flair-vents-automation"}` (the Docker logging driver's own automatic label — not the custom `service`/`air_handler_id` labels above). Every query then does its own `| json` parse and filters/groups by `msg`, `air_handler_id`, `zone_id`, `vent_id`, etc. as JSON-extracted fields, mirroring `wake-on-lan`'s own proven pattern for its containerized app panels — this is deliberately more resilient than depending on the custom pipeline stage's label promotion actually being wired correctly, since `| json` extracts every field regardless.

**Several panels read `decision.*` fields nested inside the single "Control tick decision" event, not their own dedicated event** (Open Capacity vs. Floor, Control Tick Duration). This is intentional, not a shortcut: their own dedicated events (`Pressure safeguard evaluated` unless clamped, `Control tick completed`) log at `debug`, which the deployed app never emits at its normal `LOG_LEVEL=info` — see "Log-Level Rebalancing" in the implementation plan. `Control tick decision` is logged at `info` specifically so this data survives at the app's normal operating log level.

---

## Import

1. Open Grafana → **Dashboards** → **Import**
2. Click **Upload dashboard JSON file** and select `flair-vents-automation.json`
3. Confirm the Loki datasource is mapped to the same instance used by `tesla-powerwall-automation`/`wake-on-lan` (queries reference it by name, `loki`)
4. Click **Import**

---

## Panel-to-field mapping

| Panel                                   | `msg` filter(s)                                                                                                                          | Fields used                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Vent Target vs. Reported Position       | `"Vent command dispatched"`                                                                                                              | `vent_id`, `target_pct`, `reported_pct`                                                             |
| Vent Reconciliation & Degraded Vents    | `"Vent reconciled"`, `"Vent degraded"`                                                                                                   | `vent_id`, `attempt`/`reconcile_attempts`, `reported_pct`/`last_reported_pct`                       |
| Thermal Spike Events                    | `"Thermal spike detected"`, `"Thermal spike decayed"`                                                                                    | `zone_id`, `rate_per_min`, `threshold`, `window_s`                                                  |
| Sensor Reading Age (Leading Indicator)  | `"Zone telemetry polled"`                                                                                                                | `zone_id`, `reading_age_seconds` (only logged at `info` when `reading_changed` is true)             |
| Open Capacity vs. Floor                 | `"Control tick decision"`                                                                                                                | `decision.air_handler_id`, `decision.pressure.aggregate_open_pct`                                   |
| Control Tick Duration                   | `"Control tick decision"`                                                                                                                | `decision.air_handler_id`, `decision.duration_ms`                                                   |
| Tick Decisions (raw)                    | `"Control tick decision"`                                                                                                                | the full `decision` object — expand a line for narrative/driving_zone/setpoint_push                 |
| System State                            | `"HVAC state transition"`, `"Emergency fail-safe triggered"`, `"Emergency fail-safe cleared"`, `"Control disarmed"`, `"Control rearmed"` | `from`/`to`, `fault_signal`, `actor`                                                                |
| Duct Airflow Anomaly                    | `"Duct airflow anomaly detected"`, `"Duct airflow anomaly cleared"`                                                                      | `zone_id`, `vent_id`, `duct_delta_c`, `commanded_position_pct`                                      |
| Extended Call & Setpoint Write Failures | `"HVAC extended call with no improvement"`, `"Flair setpoint write failing"`                                                             | `call_duration_minutes`, `zones_evaluated`, `written_failures`                                      |
| Flair Sync Activity                     | `"Zone sensor flags updated"`, `"Zone vent set updated"`, `"Zone hardware retrofit converted"`, `"Zone degraded — hardware removed"`     | `zone_id`, `has_temperature_sensor`/`has_occupancy_sensor`, `flair_vent_ids`, `from_type`/`to_type` |
| Reconciliation Sweeps                   | `"Startup reconciliation completed"`, `"Drift check completed"`                                                                          | `vents_checked`, `mismatches_found`                                                                 |

---

## Panel overview

| Section                                    | Panels                                                                      | Notes                                                                                                                                                                                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vent Control**                           | Vent Target vs. Reported Position, Vent Reconciliation & Degraded Vents     | The position panel plots both series per vent — a persistent gap between target and reported is exactly what "Vent degraded" (in the panel beside it) eventually fires on.                                                                        |
| **Thermal & Sensor Health**                | Thermal Spike Events, Sensor Reading Age                                    | Reading Age is deliberately sparse by design (only real changes are logged at `info`) — a widening gap for one zone while its siblings keep updating is the actual staleness signal, not a flat "no data" line.                                   |
| **Pressure, Driving Zone & Tick Duration** | Open Capacity vs. Floor, Control Tick Duration, Tick Decisions              | All three read the single exhaustive `"Control tick decision"` event rather than several narrower ones — see the Prerequisites note above for why. Tick Decisions is deliberately not chart-shaped; expand any line for the full per-tick record. |
| **Equipment Faults & System State**        | System State, Duct Airflow Anomaly, Extended Call & Setpoint Write Failures | Three genuinely distinct failure modes kept on separate panels, per the plan's own "never conflate" framing: whole-system equipment fault, an isolated per-vent duct problem, and a control-channel (Flair write) problem.                        |
| **Sync & Reconciliation**                  | Flair Sync Activity, Reconciliation Sweeps                                  | Sync Activity only has data right after a manual "Sync with Flair" action — an empty panel most of the time is expected, not broken.                                                                                                              |

---

## Notes

- **Datasource name:** all queries reference the datasource by name `loki`, same as `tesla-powerwall-automation`/`wake-on-lan` — same physical Loki instance on the NAS. If yours has a different name, update it after import in Dashboard settings → Data sources.
- **Timezone:** defaults to the browser's own timezone (not hardcoded to a specific deployment location, unlike the sibling apps' dashboards) — change in Dashboard settings → Time options if you'd rather pin it.
- **No site/tenant variable** — see Prerequisites above.
- **This dashboard is deliberately scoped to what actually logs at `info` or above (or is reachable via `Control tick decision`'s nested fields) at this app's normal `LOG_LEVEL=info`.** Several events named in the implementation plan's own event catalogue — `Zone evaluated`, `Zone excluded`, `Contention resolved`, `Driving setpoint computed`, `Vent command suppressed` — are debug-level and were deliberately left out of this dashboard rather than built as panels that would silently show "No data" in production. If you need to investigate one of them directly, temporarily set `LOG_LEVEL=debug` on the deployed container (noisy — also enables `pino-http`'s per-request logging) rather than expecting a permanent panel here to have data.
- **This dashboard also omits a small number of events named in the plan that aren't actually implemented yet** (`Zone demand with no improvement`, and Flair-outage/token-budget events that exist today only as ad hoc `log.*` calls in `util/flair/outage.ts`/`tokenBudget.ts`, not wrapped in a named `logEvents.ts` helper) — building panels against events that don't exist would fail the contract test below, and building them against unwrapped raw log calls would leave this dashboard silently unprotected against a future rename. Add both once/if those events get a proper `logEvents.ts` entry.

> **Renaming a `msg` or field breaks a panel silently — this is the one thing enforced automatically, not just documented here.** `tests/server/logEvents.contract.test.ts` parses this dashboard JSON's LogQL expressions and asserts every quoted `msg` literal exists in `src/server/logEvents.ts`'s catalogue, and every plain (non-`decision.*`) field referenced exists on that event's declared `XFields` TypeScript interface. A renamed constant or a renamed/removed field fails that test in CI — update this dashboard's queries in the **same PR** as any log message or field rename. (Fields reached via a nested `decision.*` JSON path are not checked against a TS interface — `Control tick decision`'s own payload is deliberately typed `unknown`, since it's exhaustive by design rather than a fixed dashboard-facing shape; those references are checked only for `msg="Control tick decision"` itself existing in the catalogue.)
