import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTickHistory,
  type TickHistoryPoint,
} from "~/client/api/telemetryApi";

interface UseTickHistoryResult {
  points: TickHistoryPoint[];
  loading: boolean;
  // Loki isn't configured server-side (LOKI_URL unset) — distinct from
  // "configured, but nothing logged in this window yet" (empty `points`).
  unavailable: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches one air handler's tick-decision history for a given range — the
 * one data source backing every Increment-B chart. Not polled
 * automatically (unlike DashboardPage/DiagnosticsPage's live-status
 * fetches): a historical window doesn't go stale the way "what is the
 * system doing right now" does, so a manual refresh is enough here.
 */
export function useTickHistory(
  airHandlerId: string | null,
  fromMs: number,
  toMs: number,
): UseTickHistoryResult {
  const [points, setPoints] = useState<TickHistoryPoint[]>([]);
  // Starts true, not false — with no air handler selected yet (the very
  // first render, before the caller's own air-handler fetch resolves),
  // there's genuinely nothing to report either way, and treating that as
  // "loading" (rather than a false "loaded, nothing here" reading) is what
  // stops TelemetryPage's empty-window message from flashing before a real
  // fetch has even had a chance to start.
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(() => {
    if (!airHandlerId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    fetchTickHistory(airHandlerId, fromMs, toMs)
      .then((result) => {
        if (seq !== seqRef.current) return;
        if (result === null) {
          setUnavailable(true);
          setPoints([]);
        } else {
          setUnavailable(false);
          setPoints(result);
        }
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load telemetry.",
        );
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, [airHandlerId, fromMs, toMs]);

  useEffect(() => {
    load();
  }, [load]);

  return { points, loading, unavailable, error, refetch: load };
}
