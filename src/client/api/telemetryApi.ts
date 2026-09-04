import { httpClient } from "~/client/api/httpClient";
import type { AirHandlerTickDecision } from "~/client/api/airHandlersApi";

export interface TickHistoryPoint {
  loggedAtMs: number;
  decision: AirHandlerTickDecision;
}

// See "Stage 13, Increment B" — every historical chart and the rolling
// shadow-mode agreement metric are derived client-side from this one fetch,
// rather than one endpoint per chart, since the underlying record already
// carries everything each chart needs.
//
// A `null` return means Loki isn't configured (503) — distinct from an
// empty array, which means it IS configured but nothing has been logged in
// this window yet (e.g. shortly after a fresh deploy). Callers should
// render a different message for each case.
export async function fetchTickHistory(
  airHandlerId: string,
  fromMs: number,
  toMs: number,
  limit?: number,
): Promise<TickHistoryPoint[] | null> {
  try {
    const { data } = await httpClient.get<{ points: TickHistoryPoint[] }>(
      `/telemetry/${airHandlerId}/tick-history`,
      { params: { fromMs, toMs, limit } },
    );
    return data.points;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "response" in err &&
      (err as { response?: { status?: number } }).response?.status === 503
    ) {
      return null;
    }
    throw err;
  }
}
