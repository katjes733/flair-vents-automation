import type { ReactNode } from "react";
import { useDiagnosticMode } from "~/client/theme/useDiagnosticMode";

/**
 * The single place every diagnostic-only field opts in — raw vs.
 * calibrated temp, time-since-update, sensor disagreement, reconciliation
 * retry count, degraded history, the min/max position band, etc. See
 * "MUI Theme & UI Shell" in the implementation plan.
 */
export function DiagnosticOnly({ children }: { children: ReactNode }) {
  const { diagnosticMode } = useDiagnosticMode();
  if (!diagnosticMode) return null;
  return <>{children}</>;
}
