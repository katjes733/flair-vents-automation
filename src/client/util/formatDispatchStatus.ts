import { formatPct } from "~/client/util/formatPct";

/**
 * Turns a vent's raw dispatch_decision + step_delta_pct/min_step_delta_pct
 * into a human answer to "is this the actual command that was sent, or
 * just this tick's target?" — see the fields' own doc comments
 * (tickDecision.ts / airHandlersApi.ts) for why those two are distinct.
 * Null when there's nothing meaningful to say (no dispatch decision was
 * made this tick at all — e.g. the emergency fail-safe short-circuit,
 * which already reports its own fixed "forced open" reason instead).
 */
export function formatDispatchStatus(v: {
  dispatch_decision: string;
  step_delta_pct: number | null;
  min_step_delta_pct: number | null;
}): string | null {
  if (v.dispatch_decision === "dispatched") return "sent";
  if (v.step_delta_pct === null || v.min_step_delta_pct === null) return null;
  return `holding (Δ${formatPct(v.step_delta_pct)}% of ${formatPct(v.min_step_delta_pct)}% to move)`;
}
