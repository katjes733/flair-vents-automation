import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchOverrideHistory,
  type ManualOverrideRecord,
} from "~/client/api/overridesApi";

interface UseOverrideHistoryResult {
  overrides: ManualOverrideRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * One zone's override history for a given range — backs the override
 * activity lane. Postgres-backed (not Loki), so unlike `useTickHistory`
 * there's no "not configured" case to distinguish — only loading/error.
 */
export function useOverrideHistory(
  zoneId: string | null,
  fromMs: number,
  toMs: number,
): UseOverrideHistoryResult {
  const [overrides, setOverrides] = useState<ManualOverrideRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(() => {
    if (!zoneId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    fetchOverrideHistory(zoneId, fromMs, toMs)
      .then((result) => {
        if (seq !== seqRef.current) return;
        setOverrides(result);
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load override history.",
        );
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, [zoneId, fromMs, toMs]);

  useEffect(() => {
    load();
  }, [load]);

  return { overrides, loading, error, refetch: load };
}
