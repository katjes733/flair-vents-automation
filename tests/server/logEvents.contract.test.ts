import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logSpy } from "../setup";
import * as logEvents from "~/server/logEvents";

// Builds the real msg -> field-name map by actually calling every exported
// log*() function with a fixture satisfying its real TypeScript field type
// — a renamed/removed field fails to *compile*, not just fails this test,
// which is a stronger guarantee than parsing logEvents.ts's source text by
// hand. Fields for "Control tick decision" are deliberately left as an
// empty set (see the file's own comment: its payload is typed `unknown`,
// exhaustive by design rather than a fixed dashboard-facing shape) — the
// dashboard contract only checks that msg exists, never its fields.
function buildRealCatalogue(): Map<string, Set<string>> {
  const log = logger.child({ service: "test" });

  logEvents.logHvacStateTransition(log, {
    air_handler_id: "ah-1",
    from: "IDLE",
    to: "COOLING_CALL",
    call_source: "cool",
    dry_run: false,
  });
  logEvents.logZoneEvaluated(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    temp_raw: 22,
    temp_calibrated: 22,
    setpoint: 21,
    tolerance: 0.5,
    deviation: 1,
    desired_position_pct: 50,
    satisfied: false,
    dry_run: false,
  });
  logEvents.logZoneExcluded(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    reason: "stale",
    dry_run: false,
  });
  logEvents.logContentionResolved(log, {
    air_handler_id: "ah-1",
    candidates: [{ zone_id: "z-1", bucket: "unoccupied", rank: 0 }],
    reductions: { "z-1": 10 },
    insufficient: false,
    dry_run: false,
  });
  logEvents.logPressureSafeguardEvaluated(log, {
    air_handler_id: "ah-1",
    aggregate_open_lps: 500,
    aggregate_open_pct: 60,
    floor_lps: 708,
    cap_pct: 100,
    clamped: false,
    blower_rated_flow_rate_is_estimate: true,
    minimum_aggregate_flow_is_estimate: true,
    dry_run: false,
  });
  logEvents.logDrivingSetpointComputed(log, {
    air_handler_id: "ah-1",
    driving_zone_id: "z-1",
    selection_reason: "dynamic_worst_off",
    pushed_value: 21,
    pushed_value_c: 21,
    thermostat_reading: 22,
    would_write: true,
    dry_run: false,
  });
  logEvents.logVentCommandDispatched(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    vent_id: "v-1",
    target_pct: 50,
    reported_pct: 48,
    step_delta_pct: 20,
    dry_run: false,
  });
  logEvents.logVentCommandSuppressed(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    vent_id: "v-1",
    target_pct: 50,
    last_dispatched_pct: 45,
    step_delta_pct: 5,
  });
  logEvents.logVentReconciled(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    vent_id: "v-1",
    attempt: 1,
    reported_pct: 50,
  });
  logEvents.logVentDegraded(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    vent_id: "v-1",
    reconcile_attempts: 3,
    last_reported_pct: 40,
  });
  logEvents.logThermalSpikeDetected(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    rate_per_min: 2,
    threshold: 1,
    window_s: 600,
  });
  logEvents.logThermalSpikeDecayed(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    rate_per_min: 0.5,
    threshold: 1,
    window_s: 600,
  });
  logEvents.logZoneTelemetryPolled(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    reading_changed: true,
    reading_age_seconds: 30,
  });
  logEvents.logEmergencyFailSafeTriggered(log, {
    air_handler_id: "ah-1",
    fault_signal: "duct_temperature_differential",
    duct_delta_c: 6,
  });
  logEvents.logEmergencyFailSafeCleared(log, {
    air_handler_id: "ah-1",
    fault_signal: "duct_temperature_differential",
    duct_delta_c: null,
  });
  logEvents.logHvacExtendedCallNoImprovement(log, {
    air_handler_id: "ah-1",
    call_duration_minutes: 90,
    zones_evaluated: 4,
  });
  logEvents.logFlairSetpointWriteFailing(log, {
    air_handler_id: "ah-1",
    written_failures: 3,
  });
  logEvents.logDuctAirflowAnomalyDetected(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    vent_id: "v-1",
    duct_delta_c: 3,
    commanded_position_pct: 80,
  });
  logEvents.logDuctAirflowAnomalyCleared(log, {
    air_handler_id: "ah-1",
    zone_id: "z-1",
    vent_id: "v-1",
    duct_delta_c: null,
    commanded_position_pct: 80,
  });
  logEvents.logControlDisarmed(log, { actor: "Martin" });
  logEvents.logControlRearmed(log, { actor: "Martin" });
  logEvents.logControlTickCompleted(log, {
    air_handler_id: "ah-1",
    duration_ms: 42,
    zones_evaluated: 4,
    commands_dispatched: 2,
  });
  logEvents.logStartupReconciliationCompleted(log, {
    air_handler_id: "ah-1",
    vents_checked: 3,
    mismatches_found: 0,
  });
  logEvents.logDriftCheckCompleted(log, {
    air_handler_id: "ah-1",
    vents_checked: 3,
    mismatches_found: 0,
  });
  logEvents.logZoneSensorFlagsUpdated(log, {
    zone_id: "z-1",
    has_temperature_sensor: true,
    has_occupancy_sensor: false,
  });
  logEvents.logZoneVentSetUpdated(log, {
    zone_id: "z-1",
    flair_vent_ids: ["v-1"],
  });
  logEvents.logZoneHardwareRetrofitConverted(log, {
    zone_id: "z-1",
    from_type: "no_vent",
    to_type: "flair_smart_vent",
  });
  logEvents.logZoneDegradedHardwareRemoved(log, {
    zone_id: "z-1",
    from_type: "flair_smart_vent",
    to_type: "no_vent",
  });
  logEvents.logControlTickDecision(log, { air_handler_id: "ah-1" });

  const catalogue = new Map<string, Set<string>>();
  for (const level of ["debug", "info", "warn", "error"] as const) {
    for (const call of logSpy(level).mock.calls) {
      const [fields, msg] = call as [Record<string, unknown>, string];
      const fieldNames =
        msg === "Control tick decision"
          ? new Set<string>()
          : new Set(Object.keys(fields));
      const existing = catalogue.get(msg);
      if (existing) {
        for (const f of fieldNames) existing.add(f);
      } else {
        catalogue.set(msg, fieldNames);
      }
    }
  }
  return catalogue;
}

interface PanelQueryExpr {
  expr: string;
  panelTitle: string;
}

function extractPanelQueries(dashboard: unknown): PanelQueryExpr[] {
  const results: PanelQueryExpr[] = [];
  const elements = (dashboard as { elements: Record<string, unknown> })
    .elements;
  for (const element of Object.values(elements)) {
    const spec = (element as { spec: Record<string, unknown> }).spec;
    const title = spec.title as string;
    const queries = (
      (spec.data as { spec: { queries: unknown[] } }).spec.queries as Array<{
        spec: { query: { spec: { expr?: string } } };
      }>
    ).map((q) => q.spec.query.spec.expr);
    for (const expr of queries) {
      if (expr) results.push({ expr, panelTitle: title });
    }
  }
  return results;
}

// Matches msg="X" or msg=~"A|B|C" — both forms appear across this
// dashboard's panels.
function extractMsgLiterals(expr: string): string[] {
  const exact = [...expr.matchAll(/msg="([^"]+)"/g)].map((m) => m[1]);
  const alternation = [...expr.matchAll(/msg=~"([^"]+)"/g)].flatMap((m) =>
    m[1].split("|"),
  );
  return [...exact, ...alternation];
}

// A field is only checked when it's referenced as a plain identifier via
// `unwrap <field>` or `by (<field>)` — nested `decision.*` JSON-expression
// paths (e.g. `| json foo="decision.pressure.floor_lps"`) are deliberately
// not checked against any single event's field list, since they reach into
// "Control tick decision"'s own exhaustively-typed-as-`unknown` payload —
// see this file's own module comment and the dashboard README's matching
// caveat.
function extractPlainFieldReferences(expr: string): string[] {
  const unwrapped = [...expr.matchAll(/\bunwrap\s+(\w+)/g)].map((m) => m[1]);
  const grouped = [...expr.matchAll(/\bby\s*\(([^)]+)\)/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim()),
  );
  // A field aliased from a nested `decision.*` path (e.g.
  // `| json foo="decision.pressure.floor_lps"`, at any nesting depth) is
  // reaching into "Control tick decision"'s own exhaustively-typed-as-
  // `unknown` payload, not a single event's declared field list — skip it,
  // per this file's own module comment and the dashboard README's matching
  // caveat.
  const aliasedFromDecision = new RegExp(
    String.raw`\b(\w+)\s*=\s*"decision\.[^"]+"`,
    "g",
  );
  const decisionAliases = new Set(
    [...expr.matchAll(aliasedFromDecision)].map((m) => m[1]),
  );
  return [...unwrapped, ...grouped].filter(
    (f) => f.length > 0 && !decisionAliases.has(f),
  );
}

describe("Grafana dashboard contract", () => {
  let catalogue: Map<string, Set<string>>;
  let queries: PanelQueryExpr[];

  beforeAll(() => {
    const raw = readFileSync(
      join(process.cwd(), "grafana-dashboards/flair-vents-automation.json"),
      "utf-8",
    );
    queries = extractPanelQueries(JSON.parse(raw));
  });

  // Rebuilt per-test, not in beforeAll: `logSpy()` only works once
  // tests/setup.ts's own global `beforeEach` has installed its spies on
  // `logger`, which happens *after* beforeAll runs for every test file.
  beforeEach(() => {
    catalogue = buildRealCatalogue();
  });

  it("has at least one panel query to check (guards against a silently-empty dashboard)", () => {
    expect(queries.length).toBeGreaterThan(0);
  });

  it("every quoted msg literal in the dashboard exists in the logEvents.ts catalogue", () => {
    for (const { expr, panelTitle } of queries) {
      for (const msg of extractMsgLiterals(expr)) {
        expect(
          catalogue.has(msg),
          `Panel "${panelTitle}" references msg "${msg}", which no logEvents.ts event emits. Query: ${expr}`,
        ).toBe(true);
      }
    }
  });

  it("every plain field referenced in a single-msg panel exists on that event's real field set", () => {
    for (const { expr, panelTitle } of queries) {
      const msgs = extractMsgLiterals(expr);
      const fields = extractPlainFieldReferences(expr);
      if (fields.length === 0) continue;
      // Union across every msg this query actually matches — a
      // multi-msg alternation panel's field must exist on at least one
      // of the matched events.
      const available = new Set<string>();
      for (const msg of msgs) {
        for (const f of catalogue.get(msg) ?? []) available.add(f);
      }
      for (const field of fields) {
        expect(
          available.has(field),
          `Panel "${panelTitle}" references field "${field}", which isn't declared on any of [${msgs.join(", ")}]'s real field set. Query: ${expr}`,
        ).toBe(true);
      }
    }
  });
});
