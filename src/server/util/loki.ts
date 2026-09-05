import type { AirHandlerTickDecision } from "~/server/control/tickDecision";

const lokiLog = logger.child({ service: "loki" });

// Historical telemetry (Stage 13, Increment B) reads back the shared Loki
// instance both reference apps' Grafana already queries — no new infra, per
// the implementation plan's own "Loki already retains the stream" premise.
// Optional: local dev has no reachable Loki at all, so every consumer of
// this module must handle `isLokiConfigured() === false` rather than assume
// a value.
function lokiBaseUrl(): string | null {
  return process.env.LOKI_URL || null;
}

export function isLokiConfigured(): boolean {
  return lokiBaseUrl() !== null;
}

interface LokiStreamResult {
  stream: Record<string, string>;
  values: [string, string][]; // [timestampNs, rawLine]
}

interface LokiQueryRangeResponse {
  status: string;
  data: { resultType: string; result: LokiStreamResult[] };
}

// LogQL label-value / line-filter literals are double-quoted strings — this
// escapes the two characters that would otherwise break out of that quoting
// (a backslash or an embedded quote). Ids and event names in this app never
// contain either today, but a value that reaches this function is always
// escaped anyway rather than trusted, since the query is built by string
// concatenation.
function quoteLogQlLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function queryRange(params: {
  query: string;
  startNs: string;
  endNs: string;
  limit: number;
  // Which end of the window Loki fills `limit` from when the range holds
  // more matching lines than `limit` allows — see fetchTickDecisionHistory's
  // own comment for why every current caller needs "backward" specifically.
  direction: "forward" | "backward";
}): Promise<LokiStreamResult[]> {
  const base = lokiBaseUrl();
  if (!base) {
    throw new Error(
      "LOKI_URL is not configured — historical telemetry is unavailable.",
    );
  }
  const url = new URL("/loki/api/v1/query_range", base);
  url.searchParams.set("query", params.query);
  url.searchParams.set("start", params.startNs);
  url.searchParams.set("end", params.endNs);
  url.searchParams.set("limit", String(params.limit));
  url.searchParams.set("direction", params.direction);

  const res = await fetch(url.toString());
  if (!res.ok) {
    lokiLog.warn(
      { status: res.status, query: params.query },
      "Loki query failed",
    );
    throw new Error(`Loki query failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as LokiQueryRangeResponse;
  return body.data.result;
}

export interface TickDecisionHistoryPoint {
  loggedAtMs: number;
  decision: AirHandlerTickDecision;
}

// Every historical chart in Increment B (zone temperature, vent position,
// HVAC state, open capacity, spike/degraded/fault periods, the rolling
// agreement metric) is derived from this ONE query type — the already-info-
// level `Control tick decision` event carries the full exhaustive per-tick
// record, so there's no need for a separate narrower LogQL query per chart.
// See "Stage 13, Increment B" and the plan's own "Log-Level Rebalancing"
// section, which flagged this exact approach as the simpler option once
// that event was promoted to info.
export async function fetchTickDecisionHistory(
  airHandlerId: string,
  fromMs: number,
  toMs: number,
  limit: number,
): Promise<TickDecisionHistoryPoint[]> {
  const query = `{service="control", air_handler_id=${quoteLogQlLiteral(airHandlerId)}} |= "Control tick decision"`;
  // A real, confirmed bug found live: at the default 60s tick cadence, a
  // 24h (or wider) window routinely holds far more matching lines than
  // `limit`, and Loki's own `direction=forward` fills that cap from the
  // *oldest* end of the window — so every chart silently plotted a stale
  // slice ending hours before "now" with no truncation indicator, which
  // looked exactly like a timezone bug (a correctly-local-formatted but
  // very-old timestamp) rather than the pagination bug it actually was.
  // "backward" fills from the newest end instead — every chart here cares
  // about "closest to now," never "earliest in this window" — and the
  // final sort below still puts the result back in chronological order.
  const streams = await queryRange({
    query,
    startNs: String(Math.floor(fromMs) * 1_000_000),
    endNs: String(Math.floor(toMs) * 1_000_000),
    limit,
    direction: "backward",
  });

  const points: TickDecisionHistoryPoint[] = [];
  for (const stream of streams) {
    for (const [tsNs, line] of stream.values) {
      let parsed: { decision?: AirHandlerTickDecision };
      try {
        parsed = JSON.parse(line) as { decision?: AirHandlerTickDecision };
      } catch (err) {
        lokiLog.warn(
          { err },
          "Skipped a Loki log line that failed to parse as JSON",
        );
        continue;
      }
      if (parsed.decision) {
        points.push({
          loggedAtMs: Math.floor(Number(tsNs) / 1_000_000),
          decision: parsed.decision,
        });
      }
    }
  }
  points.sort((a, b) => a.loggedAtMs - b.loggedAtMs);
  return points;
}
